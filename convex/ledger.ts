import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { BURST, cycleOf, isClosed, LINKS_PER_MINUTE, looksLikeBot, MAX_LINKS, previousCycle } from "./lib/core";
import { guard } from "./lib/guard";
import { post } from "./lib/post";
import { cycleTotals, linkClicks } from "./lib/totals";

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** How long to wait before a click is judged. Judging late is the reason corrections exist. */
const JUDGE_AFTER_MS = 30_000;

export const createLink = mutation({
  args: { serverKey: v.string(), ownerId: v.string(), url: v.string() },
  handler: async (ctx, { serverKey, ownerId, url }) => {
    guard(serverKey);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("That is not a link.");
    }
    if (!/^https?:$/.test(parsed.protocol) || url.length > 2048) throw new Error("Use a link that starts with http or https.");
    const recent = await ctx.db
      .query("links")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .order("desc")
      .take(MAX_LINKS);
    if (recent.length >= MAX_LINKS) throw new Error(`An account can have ${MAX_LINKS} links.`);
    if (recent.filter((l) => l.createdAt > Date.now() - 60_000).length >= LINKS_PER_MINUTE) throw new Error("Slow down. Wait a minute before making more links.");
    for (let tries = 0; tries < 8; tries++) {
      let code = "";
      for (let i = 0; i < 7; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      const taken = await ctx.db.query("links").withIndex("by_code", (q) => q.eq("code", code)).unique();
      if (taken) continue;
      await ctx.db.insert("links", { code, url: parsed.toString(), ownerId, createdAt: Date.now() });
      return { code, url: parsed.toString() };
    }
    throw new Error("Could not make a short code. Try again.");
  },
});

export const getLink = query({
  args: { serverKey: v.string(), code: v.string() },
  handler: async (ctx, { serverKey, code }) => {
    guard(serverKey);
    const link = await ctx.db.query("links").withIndex("by_code", (q) => q.eq("code", code)).unique();
    return link && link.deletedAt === undefined ? { url: link.url, ownerId: link.ownerId, disabled: link.disabled === true } : null;
  },
});

/** Rename a link, change where it goes, or turn it off and on. A turned-off link keeps its history. */
export const updateLink = mutation({
  args: {
    serverKey: v.string(),
    ownerId: v.string(),
    code: v.string(),
    title: v.optional(v.string()),
    url: v.optional(v.string()),
    disabled: v.optional(v.boolean()),
  },
  handler: async (ctx, { serverKey, ownerId, code, title, url, disabled }) => {
    guard(serverKey);
    const link = await ctx.db.query("links").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (!link || link.ownerId !== ownerId || link.deletedAt !== undefined) throw new Error("This link does not exist.");
    const patch: { title?: string; url?: string; disabled?: boolean } = {};
    if (title !== undefined) {
      if (title.length > 80) throw new Error("Use a name of 80 characters or fewer.");
      patch.title = title.trim();
    }
    if (url !== undefined) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("That is not a link.");
      }
      if (!/^https?:$/.test(parsed.protocol) || url.length > 2048) throw new Error("Use a link that starts with http or https.");
      patch.url = parsed.toString();
    }
    if (disabled !== undefined) patch.disabled = disabled;
    await ctx.db.patch(link._id, patch);
    return { code, ...patch };
  },
});

/**
 * Delete a link. The link stops working and leaves the lists. Its clicks and ledger lines stay,
 * because those clicks happened and were billed, and the reconciler needs them to match the meter.
 */
export const deleteLink = mutation({
  args: { serverKey: v.string(), ownerId: v.string(), code: v.string() },
  handler: async (ctx, { serverKey, ownerId, code }) => {
    guard(serverKey);
    const link = await ctx.db.query("links").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (!link || link.ownerId !== ownerId || link.deletedAt !== undefined) throw new Error("This link does not exist.");
    await ctx.db.patch(link._id, { deletedAt: Date.now() });
    return { code };
  },
});

/**
 * One click. The key is made by the caller, so a retry of the same request adds nothing.
 * The click is recorded at once. Whether it was a person is decided a moment later.
 */
export const recordClick = mutation({
  args: {
    serverKey: v.string(),
    code: v.string(),
    key: v.string(),
    at: v.number(),
    agent: v.string(),
    ipHash: v.string(),
    meta: v.optional(
      v.object({
        country: v.optional(v.string()),
        region: v.optional(v.string()),
        city: v.optional(v.string()),
        device: v.optional(v.string()),
        browser: v.optional(v.string()),
        os: v.optional(v.string()),
        referrer: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { serverKey, code, key, at, agent, ipHash, meta }) => {
    guard(serverKey);
    const link = await ctx.db.query("links").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (!link || link.disabled || link.deletedAt !== undefined) return { recorded: false, duplicate: false };
    const entryKey = `click:${key}`;
    const inserted = await post(ctx, { entryKey, ownerId: link.ownerId, eventAt: at, units: 1, kind: "click", code });
    if (inserted) {
      const clean = (value: string | undefined) => (value ? value.slice(0, 80) : undefined);
      await ctx.db.insert("clicks", {
        entryKey,
        code,
        ownerId: link.ownerId,
        at,
        agent: agent.slice(0, 200),
        ipHash,
        country: clean(meta?.country),
        region: clean(meta?.region),
        city: clean(meta?.city),
        device: clean(meta?.device),
        browser: clean(meta?.browser),
        os: clean(meta?.os),
        referrer: clean(meta?.referrer),
      });
      await ctx.scheduler.runAfter(JUDGE_AFTER_MS, internal.ledger.judge, { entryKey });
    }
    return { recorded: inserted, duplicate: !inserted };
  },
});

/** Decide whether a click was a bot. If it was, add a correction. The click row stays. */
export const judge = internalMutation({
  args: { entryKey: v.string() },
  handler: async (ctx, { entryKey }) => {
    const click = await ctx.db.query("clicks").withIndex("by_entryKey", (q) => q.eq("entryKey", entryKey)).unique();
    if (!click) return { corrected: false };
    const near = await ctx.db
      .query("clicks")
      .withIndex("by_ip", (q) => q.eq("code", click.code).eq("ipHash", click.ipHash).gte("at", click.at - 60_000).lte("at", click.at + 60_000))
      .take(BURST + 1);
    if (!looksLikeBot(click.agent, near.length)) return { corrected: false };
    const corrected = await post(ctx, {
      entryKey: `correction:${entryKey}`,
      ownerId: click.ownerId,
      // The correction belongs to the cycle of the click it undoes, even if it is made later.
      eventAt: click.at,
      units: -1,
      kind: "correction",
      reason: "bot",
      ref: entryKey,
      code: click.code,
    });
    return { corrected };
  },
});

/** Clicks that were recorded late elsewhere, sent in a batch. The keys keep a second run from counting twice. */
export const backfill = mutation({
  args: {
    serverKey: v.string(),
    ownerId: v.string(),
    clicks: v.array(v.object({ key: v.string(), code: v.string(), at: v.number() })),
  },
  handler: async (ctx, { serverKey, ownerId, clicks }) => {
    guard(serverKey);
    if (clicks.length > 500) throw new Error("Send at most 500 clicks at a time.");
    let inserted = 0;
    let duplicates = 0;
    let inClosedCycle = 0;
    const now = Date.now();
    for (const click of clicks) {
      const link = await ctx.db.query("links").withIndex("by_code", (q) => q.eq("code", click.code)).unique();
      if (!link || link.ownerId !== ownerId) continue;
      const entryKey = `click:${click.key}`;
      const added = await post(ctx, { entryKey, ownerId, eventAt: click.at, units: 1, kind: "click", code: click.code });
      if (!added) {
        duplicates += 1;
        continue;
      }
      inserted += 1;
      if (isClosed(cycleOf(click.at), now)) inClosedCycle += 1;
      await ctx.db.insert("clicks", { entryKey, code: click.code, ownerId, at: click.at, agent: "backfill", ipHash: "backfill" });
    }
    return { inserted, duplicates, inClosedCycle };
  },
});

export const overview = query({
  args: { serverKey: v.string(), ownerId: v.string() },
  handler: async (ctx, { serverKey, ownerId }) => {
    guard(serverKey);
    const cycle = cycleOf(Date.now());
    const links = await ctx.db
      .query("links")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .order("desc")
      .take(50);
    const recent = await ctx.db
      .query("ledger")
      .withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle))
      .order("desc")
      .take(15);
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle))
      .order("desc")
      .take(8);
    const reconciliations = await ctx.db.query("reconciliations").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).order("desc").take(8);
    const billing = await ctx.db.query("billing").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).unique();
    const waiting = await ctx.db.query("dirty").withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId)).collect();
    const review = await ctx.db.query("review").withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId)).collect();
    const now = await cycleTotals(ctx, ownerId, cycle);
    return {
      cycle,
      total: now.total,
      previous: { cycle: previousCycle(cycle), ...(await cycleTotals(ctx, ownerId, previousCycle(cycle))) },
      links: await Promise.all(
        links.map(async (l) => ({
          code: l.code,
          url: l.url,
          title: l.title ?? null,
          disabled: l.disabled === true,
          clicks: await linkClicks(ctx, l.code, cycle),
          createdAt: l.createdAt,
        })),
      ),
      entries: recent.map((r) => ({
        entryKey: r.entryKey,
        units: r.units,
        kind: r.kind,
        reason: r.reason ?? null,
        code: r.code ?? null,
        eventAt: r.eventAt,
      })),
      reports: reports.map((r) => ({ value: r.value, status: r.status, error: r.error ?? null, source: r.source, at: r.at })),
      reconciliations: reconciliations.map((r) => ({
        id: r._id,
        cycle: r.cycle,
        ledger: r.ledger,
        lastSent: r.lastSent,
        provider: r.provider,
        verdict: r.verdict,
        cause: r.cause,
        repaired: r.repaired,
        confirmed: r.confirmed,
        totalsOk: r.totalsOk,
        entries: r.entries,
        corrections: r.corrections,
        at: r.at,
      })),
      billing: billing ? { agreementId: billing.agreementId, featureCode: billing.featureCode } : null,
      waiting: waiting.map((w) => ({ cycle: w.cycle })),
      review: review.map((r) => ({ cycle: r.cycle })),
    };
  },
});

export const connect = mutation({
  args: { serverKey: v.string(), ownerId: v.string(), agreementId: v.string(), featureCode: v.string() },
  handler: async (ctx, { serverKey, ownerId, agreementId, featureCode }) => {
    guard(serverKey);
    const existing = await ctx.db.query("billing").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).unique();
    if (existing) await ctx.db.patch(existing._id, { agreementId, featureCode });
    else await ctx.db.insert("billing", { ownerId, agreementId, featureCode });
    // Clicks counted before billing was connected still need to be reported.
    const cycle = cycleOf(Date.now());
    const marked = await ctx.db.query("dirty").withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle)).unique();
    if (!marked) await ctx.db.insert("dirty", { ownerId, cycle, markedAt: Date.now() });
    return { ok: true };
  },
});
