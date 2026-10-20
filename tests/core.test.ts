import { describe, expect, it } from "vitest";
import { BURST, cycleOf, decide, evidenceHash, isClosed, looksLikeBot, previousCycle } from "../convex/lib/core";

const base = { ledger: 100, lastSent: 100, provider: 100, closed: false, lastReportFailed: false };

describe("cycles", () => {
  it("picks the cycle from the event time in UTC", () => {
    expect(cycleOf(Date.UTC(2026, 9, 31, 23, 59))).toBe("2026-10");
    expect(cycleOf(Date.UTC(2026, 10, 1, 0, 0))).toBe("2026-11");
  });
  it("finds the cycle before, across a year", () => {
    expect(previousCycle("2026-01")).toBe("2025-12");
    expect(previousCycle("2026-10")).toBe("2026-09");
  });
  it("closes a cycle when a later one starts", () => {
    const now = Date.UTC(2026, 10, 2);
    expect(isClosed("2026-10", now)).toBe(true);
    expect(isClosed("2026-11", now)).toBe(false);
  });
});

describe("bots", () => {
  it("flags link previews and scripts by agent", () => {
    expect(looksLikeBot("Slackbot-LinkExpanding 1.0", 1)).toBe(true);
    expect(looksLikeBot("curl/8.4.0", 1)).toBe(true);
    expect(looksLikeBot("Mozilla/5.0 (iPhone) Safari", 1)).toBe(false);
  });
  it("flags a burst from one address", () => {
    expect(looksLikeBot("Mozilla/5.0", BURST)).toBe(true);
    expect(looksLikeBot("Mozilla/5.0", BURST - 1)).toBe(false);
  });
});

describe("decide", () => {
  it("matches when all three agree", () => {
    expect(decide(base)).toMatchObject({ verdict: "match", repair: null });
  });
  it("matches when the provider agrees but the sent log is stale", () => {
    const d = decide({ ...base, lastSent: 90 });
    expect(d.verdict).toBe("match");
    expect(d.cause).toMatch(/out of date/);
  });
  it("finds over-billing from a report counted twice and repairs it with the ledger total", () => {
    const d = decide({ ...base, provider: 130 });
    expect(d).toMatchObject({ verdict: "over_billed", repair: 100 });
    expect(d.cause).toMatch(/moved without a report/);
  });
  it("finds under-billing after a failed report", () => {
    const d = decide({ ...base, lastSent: 90, provider: 90, lastReportFailed: true });
    expect(d).toMatchObject({ verdict: "under_billed", repair: 100 });
    expect(d.cause).toMatch(/last report failed/);
  });
  it("blames a late click or a correction when the provider still holds the last report", () => {
    const d = decide({ ...base, ledger: 96, lastSent: 100, provider: 100 });
    expect(d).toMatchObject({ verdict: "over_billed", repair: 96 });
    expect(d.cause).toMatch(/late click or a correction/);
  });
  it("says so when no total was ever sent", () => {
    expect(decide({ ...base, lastSent: null, provider: 0 }).cause).toMatch(/never sent/);
  });
  it("does not touch the meter of a closed cycle", () => {
    expect(decide({ ...base, provider: 90, lastSent: 90, closed: true })).toMatchObject({ verdict: "closed_cycle_drift", repair: null });
  });
  it("compares nothing when the provider cannot be read", () => {
    expect(decide({ ...base, provider: null })).toMatchObject({ verdict: "unreadable", repair: null });
  });
});

describe("evidence and retries", () => {
  it("gives the same hash for the same evidence", () => {
    const e = { ledger: 5, lastSent: null, provider: 7 };
    expect(evidenceHash("2026-10", e)).toBe(evidenceHash("2026-10", { ...e }));
    expect(evidenceHash("2026-10", e)).not.toBe(evidenceHash("2026-10", { ...e, provider: 8 }));
  });
  it("treats a checked total differently from an unchecked one", () => {
    const e = { ledger: 5, lastSent: 5, provider: 5 };
    expect(evidenceHash("2026-10", e)).not.toBe(evidenceHash("2026-10", { ...e, totalsOk: false }));
  });

});
