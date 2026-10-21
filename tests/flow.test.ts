import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { cycleOf, previousCycle, SHARDS } from "../convex/lib/core";

const modules = import.meta.glob("../convex/**/*.ts");
const serverKey = "test-key";
const ownerId = "kp_owner";

let current: { finishAllScheduledFunctions: (advance: () => void) => Promise<void> } | undefined;

async function start() {
  const t = convexTest(schema, modules);
  current = t;
  const link = await t.mutation(api.ledger.createLink, { serverKey, ownerId, url: "https://example.com/menu" });
  return { t, code: link.code };
}
type T = Awaited<ReturnType<typeof start>>["t"];

const click = (t: T, code: string, key: string, extra: { agent?: string; ipHash?: string; at?: number; meta?: Record<string, string> } = {}) =>
  t.mutation(api.ledger.recordClick, { serverKey, code, key, at: extra.at ?? Date.now(), agent: extra.agent ?? "Mozilla/5.0", ipHash: extra.ipHash ?? key, meta: extra.meta });
const view = (t: T) => t.query(api.ledger.overview, { serverKey, ownerId });
const thisCycle = () => cycleOf(Date.now());

// Clicks schedule a later judgement. Let those run before the test ends, so none fire into a finished test.
afterEach(async () => {
  await current?.finishAllScheduledFunctions(vi.runAllTimers);
  current = undefined;
});

beforeEach(() => {
  process.env.NOTCH_SERVER_KEY = serverKey;
  delete process.env.METER_DRIVER;
  vi.useFakeTimers();
});

describe("the ledger", () => {
  it("counts a click once when the same key is offered twice", async () => {
    const { t, code } = await start();
    expect(await click(t, code, "a")).toMatchObject({ recorded: true, duplicate: false });
    expect(await click(t, code, "a")).toMatchObject({ recorded: false, duplicate: true });
    expect((await view(t)).total).toBe(1);
  });

  it("refuses calls without the server key", async () => {
    const { t, code } = await start();
    await expect(t.mutation(api.ledger.recordClick, { serverKey: "wrong", code, key: "x", at: 1, agent: "a", ipHash: "b" })).rejects.toThrow("Not allowed");
  });

  it("corrects a bot click with a new negative entry and keeps the click", async () => {
    const { t, code } = await start();
    await click(t, code, "person");
    await click(t, code, "robot", { agent: "Slackbot-LinkExpanding 1.0" });
    expect((await view(t)).total).toBe(2);
    await t.mutation(internal.ledger.judge, { entryKey: "click:person" });
    await t.mutation(internal.ledger.judge, { entryKey: "click:robot" });
    await t.mutation(internal.ledger.judge, { entryKey: "click:robot" }); // judging twice adds nothing
    const v = await view(t);
    expect(v.total).toBe(1);
    expect(v.entries.filter((e) => e.kind === "correction")).toHaveLength(1);
    expect(v.entries.filter((e) => e.kind === "click")).toHaveLength(2);
  });

  it("puts a late correction in the cycle of the click it undoes", async () => {
    const { t, code } = await start();
    await click(t, code, "old-bot", { agent: "curl/8", at: Date.now() - 40 * 86_400_000 });
    await t.mutation(internal.ledger.judge, { entryKey: "click:old-bot" });
    const v = await view(t);
    expect(v.total).toBe(0);
    expect(v.previous).toMatchObject({ total: 0, corrections: 1, entries: 1 });
  });

  it("limits how fast one account can make links", async () => {
    const { t } = await start();
    for (let i = 0; i < 9; i++) await t.mutation(api.ledger.createLink, { serverKey, ownerId, url: `https://example.com/${i}` });
    await expect(t.mutation(api.ledger.createLink, { serverKey, ownerId, url: "https://example.com/more" })).rejects.toThrow("Slow down");
  });
});

describe("running totals", () => {
  it("add up to the ledger across shards, for the account and for each link", async () => {
    const { t, code } = await start();
    for (let i = 0; i < 60; i++) await click(t, code, `k${i}`);
    const v = await view(t);
    expect(v.total).toBe(60);
    expect(v.links[0].clicks).toBe(60);
    const rows = await t.run((ctx) => ctx.db.query("totals").collect());
    expect(rows.length).toBeLessThanOrEqual(SHARDS);
    expect(rows.reduce((sum, r) => sum + r.units, 0)).toBe(60);
  });

  it("are checked against the ledger, and rebuilt when they are wrong", async () => {
    const { t, code } = await start();
    for (const key of ["a", "b", "c"]) await click(t, code, key);
    await t.action(internal.recon.reportDue, {});
    await t.run(async (ctx) => {
      const row = await ctx.db.query("totals").first();
      if (row) await ctx.db.patch(row._id, { units: row.units + 5 });
    });
    expect((await view(t)).total).toBe(8);
    const results = await t.action(api.recon.reconcileNow, { serverKey, ownerId });
    expect(results.find((r) => r.cycle === thisCycle())).toMatchObject({ totalsOk: false, ledger: 3 });
    expect((await view(t)).total).toBe(3);
  });

  it("are proven by scanning every page of a long ledger", async () => {
    const { t } = await start();
    await t.run(async (ctx) => {
      for (let i = 0; i < 2500; i++) {
        await ctx.db.insert("ledger", { entryKey: `bulk:${i}`, ownerId, feature: "clicks", cycle: thisCycle(), eventAt: Date.now() + i, recordedAt: Date.now(), units: 1, kind: "click" });
      }
    });
    const results = await t.action(api.recon.reconcileNow, { serverKey, ownerId });
    expect(results.find((r) => r.cycle === thisCycle())).toMatchObject({ ledger: 2500, verdict: "under_billed", repaired: true, confirmed: true });
  });
});

describe("the reporter", () => {
  it("turns many clicks into one absolute report", async () => {
    const { t, code } = await start();
    for (const key of ["a", "b", "c"]) await click(t, code, key);
    await t.action(internal.recon.reportDue, {});
    let v = await view(t);
    expect(v.reports).toHaveLength(1);
    expect(v.reports[0]).toMatchObject({ value: 3, status: "sent" });
    expect(v.waiting).toHaveLength(0);
    await t.action(internal.recon.reportDue, {}); // nothing changed, so nothing is sent
    v = await view(t);
    expect(v.reports).toHaveLength(1);
  });

  it("marks the cycle again when a report fails, and sends the newest total on the next run", async () => {
    const { t, code } = await start();
    await click(t, code, "a");
    await t.mutation(api.sim.failNext, { serverKey, ownerId, count: 1 });
    await t.action(internal.recon.reportDue, {});
    let v = await view(t);
    expect(v.reports[0]).toMatchObject({ status: "failed" });
    expect(v.waiting).toHaveLength(1);
    await click(t, code, "b"); // a click while the cycle is waiting
    await t.action(internal.recon.reportDue, {});
    v = await view(t);
    expect(v.reports[0]).toMatchObject({ status: "sent", value: 2 });
    expect(v.waiting).toHaveLength(0);
  });

  it("never loses a click that arrives after the total was read", async () => {
    const { t, code } = await start();
    await click(t, code, "a");
    const claimed = await t.mutation(internal.recon.claim, { limit: 10 });
    expect(claimed).toMatchObject([{ total: 1 }]);
    await click(t, code, "b"); // arrives after the read, before the send
    expect((await view(t)).waiting).toHaveLength(1);
    await t.action(internal.recon.reportDue, {});
    expect((await view(t)).reports[0]).toMatchObject({ value: 2, status: "sent" });
  });

  it("does not report until a billing account is connected to Kinde, then reports the waiting total", async () => {
    const { t, code } = await start();
    await click(t, code, "a");
    process.env.METER_DRIVER = "kinde";
    await t.action(internal.recon.reportDue, {});
    expect((await view(t)).reports).toHaveLength(0);
    await t.mutation(api.ledger.connect, { serverKey, ownerId, agreementId: "agr_1", featureCode: "clicks" });
    expect((await view(t)).waiting).toHaveLength(1);
  });
});

describe("the reconciler", () => {
  it("finds a counted-twice report, repairs it, reads it back, and then stays quiet", async () => {
    const { t, code } = await start();
    for (const key of ["a", "b", "c", "d"]) await click(t, code, key);
    await t.action(internal.recon.reportDue, {});
    await t.mutation(api.sim.drift, { serverKey, ownerId, amount: 6 });

    const first = await t.action(api.recon.reconcileNow, { serverKey, ownerId });
    const now = first.find((r) => r.cycle === thisCycle())!;
    expect(now).toMatchObject({ verdict: "over_billed", ledger: 4, provider: 10, repaired: true, confirmed: true, totalsOk: true });
    expect(now.cause).toMatch(/moved without a report/);

    const second = await t.action(api.recon.reconcileNow, { serverKey, ownerId });
    expect(second.find((r) => r.cycle === thisCycle())).toMatchObject({ verdict: "match", repaired: false });
    const count = (await view(t)).reconciliations.length;
    await t.action(api.recon.reconcileNow, { serverKey, ownerId });
    expect((await view(t)).reconciliations).toHaveLength(count);
  });

  it("records a match after a repair, even when an older row says the same", async () => {
    const { t, code } = await start();
    await click(t, code, "a");
    await t.action(internal.recon.reportDue, {});
    await t.action(api.recon.reconcileNow, { serverKey, ownerId }); // match
    await t.mutation(api.sim.drift, { serverKey, ownerId, amount: 3 });
    await t.action(api.recon.reconcileNow, { serverKey, ownerId }); // over-billed, repaired
    await t.action(api.recon.reconcileNow, { serverKey, ownerId }); // match again: the latest state
    const rows = (await view(t)).reconciliations.filter((r) => r.cycle === thisCycle());
    expect(rows.map((r) => r.verdict)).toEqual(["match", "over_billed", "match"]);
  });

  it("finds a late click that the last report missed", async () => {
    const { t, code } = await start();
    await click(t, code, "a");
    await t.action(internal.recon.reportDue, {});
    await click(t, code, "robot", { agent: "curl/8" });
    await t.action(internal.recon.reportDue, {});
    await t.mutation(internal.ledger.judge, { entryKey: "click:robot" });
    const results = await t.action(api.recon.reconcileNow, { serverKey, ownerId });
    const now = results.find((r) => r.cycle === thisCycle())!;
    expect(now).toMatchObject({ verdict: "over_billed", ledger: 1, provider: 2, repaired: true, confirmed: true });
    expect(now.cause).toMatch(/late click or a correction/);
  });

  it("flags a backfill into a closed cycle for review and leaves the meter alone", async () => {
    const { t, code } = await start();
    const lastMonth = Date.now() - 40 * 86_400_000;
    const result = await t.mutation(api.ledger.backfill, {
      serverKey,
      ownerId,
      clicks: [
        { key: "late-1", code, at: lastMonth },
        { key: "late-2", code, at: lastMonth },
      ],
    });
    expect(result).toMatchObject({ inserted: 2, inClosedCycle: 2, duplicates: 0 });
    expect(await t.mutation(api.ledger.backfill, { serverKey, ownerId, clicks: [{ key: "late-1", code, at: lastMonth }] })).toMatchObject({ inserted: 0, duplicates: 1 });
    let v = await view(t);
    expect(v.review).toHaveLength(1);
    expect(v.waiting).toHaveLength(0);
    const results = await t.action(api.recon.reconcileNow, { serverKey, ownerId });
    expect(results.find((r) => r.cycle === previousCycle(thisCycle()))).toMatchObject({ verdict: "closed_cycle_drift", ledger: 2, provider: 0, repaired: false });
    v = await view(t);
    expect(v.review).toHaveLength(1); // still needs a person
  });

  it("does not reconcile a past cycle that has no ledger", async () => {
    const { t, code } = await start();
    await click(t, code, "a");
    const results = await t.action(api.recon.reconcileNow, { serverKey, ownerId });
    expect(results.map((r) => r.cycle)).toEqual([thisCycle()]);
  });

  it("walks every account in pages at night", async () => {
    const { t, code } = await start();
    await click(t, code, "a");
    await t.mutation(api.sim.drift, { serverKey, ownerId, amount: 4 });
    await t.action(internal.recon.reconcileAll, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const v = await view(t);
    expect(v.reconciliations.some((r) => r.verdict === "over_billed" && r.repaired)).toBe(true);
  });

  it("reports that the provider cannot be read instead of guessing", async () => {
    const { t, code } = await start();
    await click(t, code, "a");
    process.env.METER_DRIVER = "kinde"; // no agreement is connected, so there is no meter
    const results = await t.action(api.recon.reconcileNow, { serverKey, ownerId });
    expect(results.every((r) => r.verdict === "unreadable")).toBe(true);
  });
});

describe("links and analytics", () => {
  it("keeps where a click came from and summarises it for one link", async () => {
    const { t, code } = await start();
    await click(t, code, "a", { meta: { country: "NG", region: "LA", city: "Lagos", device: "Mobile", browser: "Chrome", os: "Android", referrer: "x.com" } });
    await click(t, code, "b", { meta: { country: "NG", device: "Desktop", browser: "Safari", os: "macOS" } });
    await click(t, code, "c", { meta: { country: "GB", city: "London", device: "Desktop", browser: "Chrome", os: "Windows" } });
    await click(t, code, "d");
    const page = await t.query(api.analytics.forLink, { serverKey, ownerId, code });
    expect(page).not.toBeNull();
    expect(page!.clicksThisCycle).toBe(4);
    expect(page!.summary.sample).toBe(4);
    expect(page!.summary.countries[0]).toEqual({ name: "NG", count: 2 });
    expect(page!.summary.countries.find((c) => c.name === "Unknown")?.count).toBe(1);
    expect(page!.summary.referrers.find((c) => c.name === "x.com")?.count).toBe(1);
    expect(page!.summary.days.at(-1)?.count).toBe(4);
    expect(page!.recent).toHaveLength(4);
  });

  it("shows a link only to its owner", async () => {
    const { t, code } = await start();
    expect(await t.query(api.analytics.forLink, { serverKey, ownerId: "someone_else", code })).toBeNull();
    const account = await t.query(api.analytics.forAccount, { serverKey, ownerId: "someone_else" });
    expect(account.summary.sample).toBe(0);
  });

  it("summarises all of an account's links together", async () => {
    const { t, code } = await start();
    const second = await t.mutation(api.ledger.createLink, { serverKey, ownerId, url: "https://example.com/two" });
    await click(t, code, "a", { meta: { country: "NG" } });
    await click(t, second.code, "b", { meta: { country: "NG" } });
    const account = await t.query(api.analytics.forAccount, { serverKey, ownerId });
    expect(account.summary.sample).toBe(2);
    expect(account.summary.countries[0]).toEqual({ name: "NG", count: 2 });
  });

  it("renames a link, changes where it goes, and rejects a bad link", async () => {
    const { t, code } = await start();
    const saved = await t.mutation(api.ledger.updateLink, { serverKey, ownerId, code, title: " Menu ", url: "https://example.com/new" });
    expect(saved.title).toBe("Menu");
    const page = await t.query(api.analytics.forLink, { serverKey, ownerId, code });
    expect(page!.link).toMatchObject({ title: "Menu", url: "https://example.com/new" });
    await expect(t.mutation(api.ledger.updateLink, { serverKey, ownerId, code, url: "ftp://x" })).rejects.toThrow("http");
    await expect(t.mutation(api.ledger.updateLink, { serverKey, ownerId: "someone_else", code, title: "x" })).rejects.toThrow("does not exist");
  });

  it("records no click on a turned-off link and keeps its history", async () => {
    const { t, code } = await start();
    await click(t, code, "a");
    await t.mutation(api.ledger.updateLink, { serverKey, ownerId, code, disabled: true });
    const refused = await click(t, code, "b");
    expect(refused.recorded).toBe(false);
    expect((await view(t)).total).toBe(1);
    expect(await t.query(api.ledger.getLink, { serverKey, code })).toMatchObject({ disabled: true });
    await t.mutation(api.ledger.updateLink, { serverKey, ownerId, code, disabled: false });
    expect((await click(t, code, "c")).recorded).toBe(true);
  });

  it("deletes a link: it leaves the lists and stops working, and its clicks stay in the ledger", async () => {
    const { t, code } = await start();
    await click(t, code, "a");
    await click(t, code, "b");
    await expect(t.mutation(api.ledger.deleteLink, { serverKey, ownerId: "someone_else", code })).rejects.toThrow("does not exist");
    await t.mutation(api.ledger.deleteLink, { serverKey, ownerId, code });
    expect(await t.query(api.ledger.getLink, { serverKey, code })).toBeNull();
    expect(await t.query(api.analytics.forLink, { serverKey, ownerId, code })).toBeNull();
    expect((await view(t)).links.find((l) => l.code === code)).toBeUndefined();
    expect((await click(t, code, "c")).recorded).toBe(false);
    expect((await view(t)).total).toBe(2);
    await expect(t.mutation(api.ledger.deleteLink, { serverKey, ownerId, code })).rejects.toThrow("does not exist");
    await expect(t.mutation(api.ledger.updateLink, { serverKey, ownerId, code, title: "x" })).rejects.toThrow("does not exist");
  });

  it("names cycles from the agreement start, and refuses to move the start after a click", async () => {
    const { t, code } = await start();
    const start1 = Date.now() - 5 * 86_400_000;
    await t.mutation(api.ledger.connect, { serverKey, ownerId, agreementId: "agr_1", featureCode: "clicks", cycleStart: start1 });
    const before = start1 - 60_000;
    await click(t, code, "old", { at: before });
    await click(t, code, "new");
    const ledger = await t.run(async (ctx) => ctx.db.query("ledger").collect());
    const cycles = new Map(ledger.map((r) => [r.entryKey, r.cycle]));
    expect(cycles.get("click:new")).toBe(cycleOf(Date.now(), start1));
    expect(cycles.get("click:old")).toBe(cycleOf(before, start1));
    expect(cycles.get("click:old")).not.toBe(cycles.get("click:new"));
    await expect(t.mutation(api.ledger.connect, { serverKey, ownerId, agreementId: "agr_1", featureCode: "clicks", cycleStart: start1 - 86_400_000 })).rejects.toThrow("before the first click");
    await expect(t.mutation(api.ledger.connect, { serverKey, ownerId: "kp_other", agreementId: "agr_2", featureCode: "clicks", cycleStart: Date.UTC(2026, 9, 30) })).rejects.toThrow("1st to the 28th");
  });
});
