import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import {
  CLAIM_BATCH,
  cycleOf,
  decide,
  evidenceHash,
  isClosed,
  MAX_BATCHES,
  previousCycle,
  RECON_PAGE,
  RECON_PARALLEL,
  SCAN_PAGE,
  SEND_PARALLEL,
  type Verdict,
} from "./lib/core";
import { guard } from "./lib/guard";
import { isRateLimit, kindeMeter, type Meter } from "./lib/meter";
import { cycleTotals, type CycleTotals } from "./lib/totals";

type Billing = { agreementId: string; featureCode: string } | null;

/** The meter for this account: Kinde when METER_DRIVER is "kinde", the built-in stand-in otherwise. */
function meterFor(ctx: ActionCtx, ownerId: string, billing: Billing): Meter | null {
  if (process.env.METER_DRIVER === "kinde") return billing ? kindeMeter(billing) : null;
  return {
    read: (cycle) => ctx.runQuery(internal.sim.read, { ownerId, cycle }),
    set: async (cycle, value) => {
      const result = await ctx.runMutation(internal.sim.write, { ownerId, cycle, value });
      if (!result.ok) throw new Error("The provider did not answer (simulated outage).");
    },
  };
}

/** Run a function over a list, a few at a time. */
async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// ---------- the reporter ----------

export const logReport = internalMutation({
  args: {
    ownerId: v.string(),
    cycle: v.string(),
    value: v.number(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
    source: v.union(v.literal("reporter"), v.literal("reconciler")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("reports", { ...args, at: Date.now() });
  },
});

/** Mark a cycle as needing a report. A cycle that is already marked stays as it is. */
export const mark = internalMutation({
  args: { ownerId: v.string(), cycle: v.string() },
  handler: async (ctx, { ownerId, cycle }) => {
    const row = await ctx.db.query("dirty").withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle)).unique();
    if (!row) await ctx.db.insert("dirty", { ownerId, cycle, markedAt: Date.now() });
  },
});

interface Claimed {
  ownerId: string;
  cycle: string;
  total: number;
  billing: Billing;
}

/**
 * Take a batch of marked cycles and read each total in the same transaction.
 * A click that arrives after the claim marks the cycle again, so it is never lost between the read and the send.
 * A cycle that closed while it waited goes to review instead, because the meter is not written for a closed cycle.
 */
export const claim = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, { limit }): Promise<Claimed[]> => {
    const rows = await ctx.db.query("dirty").withIndex("by_marked").order("asc").take(limit);
    const claimed: Claimed[] = [];
    for (const row of rows) {
      await ctx.db.delete(row._id);
      if (isClosed(row.cycle, Date.now())) {
        const flagged = await ctx.db.query("review").withIndex("by_owner_cycle", (q) => q.eq("ownerId", row.ownerId).eq("cycle", row.cycle)).unique();
        if (!flagged) await ctx.db.insert("review", { ownerId: row.ownerId, cycle: row.cycle, since: Date.now() });
        continue;
      }
      const totals = await cycleTotals(ctx, row.ownerId, row.cycle);
      const billing = await ctx.db.query("billing").withIndex("by_owner", (q) => q.eq("ownerId", row.ownerId)).unique();
      claimed.push({
        ownerId: row.ownerId,
        cycle: row.cycle,
        total: totals.total,
        billing: billing ? { agreementId: billing.agreementId, featureCode: billing.featureCode } : null,
      });
    }
    return claimed;
  },
});

type Outcome = "sent" | "failed" | "limited" | "skipped";

/**
 * Send one total. The write is absolute, so sending the same total twice leaves the same total.
 * There is no retry schedule: the caller marks a failed cycle again, and the next minute sends the newest total.
 */
async function send(ctx: ActionCtx, row: Claimed): Promise<Outcome> {
  const meter = meterFor(ctx, row.ownerId, row.billing);
  if (!meter) return "skipped"; // No billing account yet. Connecting one marks the cycle again.
  try {
    await meter.set(row.cycle, row.total);
    await ctx.runMutation(internal.recon.logReport, { ownerId: row.ownerId, cycle: row.cycle, value: row.total, status: "sent", source: "reporter" });
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : "The report failed.";
    await ctx.runMutation(internal.recon.logReport, { ownerId: row.ownerId, cycle: row.cycle, value: row.total, status: "failed", error: message, source: "reporter" });
    return isRateLimit(error) ? "limited" : "failed";
  }
}

/**
 * Runs every minute. It works in batches, a few sends at a time, and stops early if the provider says to slow down.
 * Many clicks in a minute become one report for the account, because a report is a total.
 */
export const reportDue = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    let sent = 0;
    // Cycles to mark again once this run is over. Marking them during the run would send them again at once.
    const later: Claimed[] = [];
    for (let batchNumber = 0; batchNumber < MAX_BATCHES; batchNumber++) {
      const batch = await ctx.runMutation(internal.recon.claim, { limit: CLAIM_BATCH });
      if (batch.length === 0) break;
      let limited = false;
      for (let i = 0; i < batch.length; i += SEND_PARALLEL) {
        const chunk = batch.slice(i, i + SEND_PARALLEL);
        if (limited) {
          later.push(...chunk);
          continue;
        }
        const results = await Promise.all(chunk.map((row) => send(ctx, row)));
        results.forEach((result, index) => {
          if (result === "sent") sent += 1;
          if (result === "failed" || result === "limited") later.push(chunk[index]);
        });
        if (results.includes("limited")) limited = true;
      }
      if (limited) break;
    }
    for (const row of later) await ctx.runMutation(internal.recon.mark, { ownerId: row.ownerId, cycle: row.cycle });
    return sent;
  },
});

// ---------- the reconciler ----------

interface Snapshot {
  lastSent: number | null;
  lastReportFailed: boolean;
  billing: Billing;
  totals: CycleTotals;
}

export const snapshot = internalQuery({
  args: { ownerId: v.string(), cycle: v.string() },
  handler: async (ctx, { ownerId, cycle }): Promise<Snapshot> => {
    const recent = await ctx.db.query("reports").withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle)).order("desc").take(20);
    const lastSentRow = recent.find((r) => r.status === "sent");
    const billing = await ctx.db.query("billing").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).unique();
    return {
      lastSent: lastSentRow ? lastSentRow.value : null,
      lastReportFailed: recent.length > 0 && recent[0].status === "failed",
      billing: billing ? { agreementId: billing.agreementId, featureCode: billing.featureCode } : null,
      totals: await cycleTotals(ctx, ownerId, cycle),
    };
  },
});

export const totalsOf = internalQuery({
  args: { ownerId: v.string(), cycle: v.string() },
  handler: async (ctx, { ownerId, cycle }): Promise<CycleTotals> => cycleTotals(ctx, ownerId, cycle),
});

/** One page of the ledger, added up. Pages keep each read small, however long the ledger is. */
export const scanPage = internalQuery({
  args: { ownerId: v.string(), cycle: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { ownerId, cycle, cursor }) => {
    const page = await ctx.db
      .query("ledger")
      .withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle))
      .paginate({ numItems: SCAN_PAGE, cursor });
    let total = 0;
    let entries = 0;
    let corrections = 0;
    for (const row of page.page) {
      total += row.units;
      if (row.kind === "correction") corrections += 1;
      else entries += 1;
    }
    return { total, entries, corrections, isDone: page.isDone, cursor: page.continueCursor };
  },
});

/** The total of the ledger, proven by reading every row. This is the record of what happened. */
async function scan(ctx: ActionCtx, ownerId: string, cycle: string): Promise<CycleTotals> {
  const sum: CycleTotals = { total: 0, entries: 0, corrections: 0 };
  let cursor: string | null = null;
  for (;;) {
    const page: { total: number; entries: number; corrections: number; isDone: boolean; cursor: string } = await ctx.runQuery(internal.recon.scanPage, { ownerId, cycle, cursor });
    sum.total += page.total;
    sum.entries += page.entries;
    sum.corrections += page.corrections;
    if (page.isDone) return sum;
    cursor = page.cursor;
  }
}

/**
 * Replace the running totals with the proven ones, but only if nothing was written since they were read.
 * If a click arrived in between, do nothing: the next reconcile will check again.
 */
export const rebuildTotals = internalMutation({
  args: { ownerId: v.string(), cycle: v.string(), observed: v.number(), total: v.number(), entries: v.number(), corrections: v.number() },
  handler: async (ctx, { ownerId, cycle, observed, total, entries, corrections }) => {
    const rows = await ctx.db.query("totals").withIndex("by_owner_cycle_shard", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle)).collect();
    if (rows.reduce((sum, r) => sum + r.units, 0) !== observed) return false;
    for (const row of rows) await ctx.db.delete(row._id);
    await ctx.db.insert("totals", { ownerId, cycle, shard: 0, units: total, entries, corrections });
    return true;
  },
});

export const record = internalMutation({
  args: {
    ownerId: v.string(),
    cycle: v.string(),
    hash: v.string(),
    ledger: v.number(),
    lastSent: v.union(v.number(), v.null()),
    provider: v.union(v.number(), v.null()),
    verdict: v.string(),
    cause: v.string(),
    repaired: v.boolean(),
    confirmed: v.union(v.boolean(), v.null()),
    totalsOk: v.union(v.boolean(), v.null()),
    entries: v.number(),
    corrections: v.number(),
  },
  handler: async (ctx, args) => {
    // A closed cycle that now matches no longer needs a person to look at it.
    if (args.verdict === "match") {
      const flagged = await ctx.db.query("review").withIndex("by_owner_cycle", (q) => q.eq("ownerId", args.ownerId).eq("cycle", args.cycle)).unique();
      if (flagged) await ctx.db.delete(flagged._id);
    }
    // The same evidence gives the same hash. A repeat of the same finding adds no row.
    const same = await ctx.db
      .query("reconciliations")
      .withIndex("by_hash", (q) => q.eq("ownerId", args.ownerId).eq("cycle", args.cycle).eq("hash", args.hash))
      .first();
    if (same && !args.repaired) return { id: same._id, created: false };
    const id = await ctx.db.insert("reconciliations", { ...args, at: Date.now() });
    return { id, created: true };
  },
});

export interface Result {
  cycle: string;
  verdict: Verdict;
  cause: string;
  ledger: number;
  lastSent: number | null;
  provider: number | null;
  repaired: boolean;
  confirmed: boolean | null;
  totalsOk: boolean | null;
}

/**
 * Prove the provider's total against the ledger for one cycle, repair it if it is wrong, and store the evidence.
 * The repair is an absolute write, so running this again changes nothing once the totals agree.
 */
async function reconcile(ctx: ActionCtx, ownerId: string, cycle: string): Promise<Result> {
  const snap = await ctx.runQuery(internal.recon.snapshot, { ownerId, cycle });
  const truth = await scan(ctx, ownerId, cycle);
  const meter = meterFor(ctx, ownerId, snap.billing);
  let provider: number | null = null;
  if (meter) {
    try {
      provider = await meter.read(cycle);
    } catch {
      provider = null;
    }
  }

  // Check the running totals against the scan. If clicks arrived during the scan, say so and skip the check.
  const after = await ctx.runQuery(internal.recon.totalsOf, { ownerId, cycle });
  let totalsOk: boolean | null = null;
  if (snap.totals.total === after.total && snap.totals.entries === after.entries && snap.totals.corrections === after.corrections) {
    totalsOk = after.total === truth.total && after.entries === truth.entries && after.corrections === truth.corrections;
    if (!totalsOk) await ctx.runMutation(internal.recon.rebuildTotals, { ownerId, cycle, observed: after.total, ...truth });
  }

  const decision = decide({ ledger: truth.total, lastSent: snap.lastSent, provider, closed: isClosed(cycle, Date.now()), lastReportFailed: snap.lastReportFailed });
  let repaired = false;
  let confirmed: boolean | null = null;
  let cause = decision.cause;
  if (decision.repair !== null && meter) {
    try {
      await meter.set(cycle, decision.repair);
      repaired = true;
      await ctx.runMutation(internal.recon.logReport, { ownerId, cycle, value: decision.repair, status: "sent", source: "reconciler" });
      // Read it back. A repair that is not read back is a hope, not evidence.
      confirmed = (await meter.read(cycle)) === decision.repair;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The repair failed.";
      await ctx.runMutation(internal.recon.logReport, { ownerId, cycle, value: decision.repair, status: "failed", error: message, source: "reconciler" });
      cause = `${cause} The repair failed: ${message}`;
    }
  }
  await ctx.runMutation(internal.recon.record, {
    ownerId,
    cycle,
    hash: evidenceHash(cycle, { ledger: truth.total, lastSent: snap.lastSent, provider, totalsOk }),
    ledger: truth.total,
    lastSent: snap.lastSent,
    provider,
    verdict: decision.verdict,
    cause,
    repaired,
    confirmed,
    totalsOk,
    entries: truth.entries,
    corrections: truth.corrections,
  });
  return { cycle, verdict: decision.verdict, cause, ledger: truth.total, lastSent: snap.lastSent, provider, repaired, confirmed, totalsOk };
}

export const hasCycle = internalQuery({
  args: { ownerId: v.string(), cycle: v.string() },
  handler: async (ctx, { ownerId, cycle }): Promise<boolean> =>
    (await ctx.db.query("cycles").withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle)).unique()) !== null,
});

/** Reconcile this cycle, and the one before it if the account has a ledger in it. A cycle with no ledger has nothing to prove. */
export const reconcileNow = action({
  args: { serverKey: v.string(), ownerId: v.string() },
  handler: async (ctx, { serverKey, ownerId }): Promise<Result[]> => {
    guard(serverKey);
    const cycle = cycleOf(Date.now());
    const results: Result[] = [];
    const before = previousCycle(cycle);
    if (await ctx.runQuery(internal.recon.hasCycle, { ownerId, cycle: before })) results.push(await reconcile(ctx, ownerId, before));
    results.push(await reconcile(ctx, ownerId, cycle));
    return results;
  },
});

// ---------- the nightly walk ----------

/** One page of accounts to reconcile: every account with a ledger in a cycle, or every flagged closed cycle. */
export const targets = internalQuery({
  args: { source: v.union(v.literal("cycle"), v.literal("review")), cycle: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { source, cycle, cursor }) => {
    if (source === "cycle") {
      const page = await ctx.db.query("cycles").withIndex("by_cycle", (q) => q.eq("cycle", cycle)).paginate({ numItems: RECON_PAGE, cursor });
      return { items: page.page.map((r) => ({ ownerId: r.ownerId, cycle: r.cycle })), isDone: page.isDone, cursor: page.continueCursor };
    }
    const page = await ctx.db.query("review").paginate({ numItems: RECON_PAGE, cursor });
    return { items: page.page.map((r) => ({ ownerId: r.ownerId, cycle: r.cycle })), isDone: page.isDone, cursor: page.continueCursor };
  },
});

/** Reconcile one page, then schedule the next. No single run has to hold the whole night's work. */
export const reconcilePage = internalAction({
  args: { source: v.union(v.literal("cycle"), v.literal("review")), cycle: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { source, cycle, cursor }): Promise<number> => {
    const page = await ctx.runQuery(internal.recon.targets, { source, cycle, cursor });
    await inChunks(page.items, RECON_PARALLEL, async (item) => {
      try {
        await reconcile(ctx, item.ownerId, item.cycle);
      } catch (error) {
        console.error("Reconcile failed for one account", item.ownerId, item.cycle, error);
      }
    });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.recon.reconcilePage, { source, cycle, cursor: page.cursor });
    return page.items.length;
  },
});

/** Runs every night. Starts one walk for this cycle, one for the last, and one for flagged closed cycles. */
export const reconcileAll = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const cycle = cycleOf(Date.now());
    await ctx.scheduler.runAfter(0, internal.recon.reconcilePage, { source: "cycle", cycle, cursor: null });
    await ctx.scheduler.runAfter(0, internal.recon.reconcilePage, { source: "cycle", cycle: previousCycle(cycle), cursor: null });
    await ctx.scheduler.runAfter(0, internal.recon.reconcilePage, { source: "review", cycle, cursor: null });
  },
});
