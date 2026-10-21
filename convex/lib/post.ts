import type { MutationCtx } from "../_generated/server";
import { anchorOf } from "./anchor";
import { cycleOf, FEATURE, isClosed, SHARDS } from "./core";

export interface Entry {
  entryKey: string;
  ownerId: string;
  eventAt: number;
  units: number;
  kind: "click" | "correction";
  reason?: string;
  ref?: string;
  code?: string;
}

/**
 * Add one entry to the ledger. The entry key makes this safe to repeat:
 * a second offer of the same key adds nothing. Returns true when the entry is new.
 *
 * One write path does everything that must stay in step, in one transaction:
 * the ledger row, the running totals, and the mark that tells the reporter to send a new total.
 */
export async function post(ctx: MutationCtx, entry: Entry): Promise<boolean> {
  const existing = await ctx.db
    .query("ledger")
    .withIndex("by_entryKey", (q) => q.eq("entryKey", entry.entryKey))
    .unique();
  if (existing) return false;

  const anchor = await anchorOf(ctx, entry.ownerId);
  const cycle = cycleOf(entry.eventAt, anchor);
  const now = Date.now();
  await ctx.db.insert("ledger", { ...entry, feature: FEATURE, cycle, recordedAt: now });

  // A random shard, so that many writers rarely touch the same row.
  const shard = Math.floor(Math.random() * SHARDS);
  const total = await ctx.db
    .query("totals")
    .withIndex("by_owner_cycle_shard", (q) => q.eq("ownerId", entry.ownerId).eq("cycle", cycle).eq("shard", shard))
    .unique();
  const isClick = entry.kind === "click" ? 1 : 0;
  if (total) {
    await ctx.db.patch(total._id, {
      units: total.units + entry.units,
      entries: total.entries + isClick,
      corrections: total.corrections + (1 - isClick),
    });
  } else {
    await ctx.db.insert("totals", {
      ownerId: entry.ownerId,
      cycle,
      shard,
      units: entry.units,
      entries: isClick,
      corrections: 1 - isClick,
    });
    const known = await ctx.db
      .query("cycles")
      .withIndex("by_owner_cycle", (q) => q.eq("ownerId", entry.ownerId).eq("cycle", cycle))
      .unique();
    if (!known) await ctx.db.insert("cycles", { ownerId: entry.ownerId, cycle });
  }

  if (entry.code) {
    const link = await ctx.db
      .query("linkTotals")
      .withIndex("by_code_cycle_shard", (q) => q.eq("code", entry.code!).eq("cycle", cycle).eq("shard", shard))
      .unique();
    if (link) await ctx.db.patch(link._id, { units: link.units + entry.units });
    else await ctx.db.insert("linkTotals", { code: entry.code, cycle, shard, units: entry.units });
  }

  if (isClosed(cycle, now, anchor)) {
    // The meter is not written for a closed cycle. Flag it so the reconciler looks at it.
    const flagged = await ctx.db
      .query("review")
      .withIndex("by_owner_cycle", (q) => q.eq("ownerId", entry.ownerId).eq("cycle", cycle))
      .unique();
    if (!flagged) await ctx.db.insert("review", { ownerId: entry.ownerId, cycle, since: now });
  } else {
    // Mark the cycle once. More clicks while it is marked add no write here.
    const marked = await ctx.db
      .query("dirty")
      .withIndex("by_owner_cycle", (q) => q.eq("ownerId", entry.ownerId).eq("cycle", cycle))
      .unique();
    if (!marked) await ctx.db.insert("dirty", { ownerId: entry.ownerId, cycle, markedAt: now });
  }
  return true;
}
