import type { QueryCtx } from "../_generated/server";

export interface CycleTotals {
  /** Net units for the cycle, after corrections. */
  total: number;
  entries: number;
  corrections: number;
}

/** The running total for one account and cycle: the sum of a few small rows. */
export async function cycleTotals(ctx: QueryCtx, ownerId: string, cycle: string): Promise<CycleTotals> {
  const rows = await ctx.db
    .query("totals")
    .withIndex("by_owner_cycle_shard", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle))
    .collect();
  return rows.reduce(
    (sum, r) => ({ total: sum.total + r.units, entries: sum.entries + r.entries, corrections: sum.corrections + r.corrections }),
    { total: 0, entries: 0, corrections: 0 },
  );
}

/** The net clicks of one link in one cycle. */
export async function linkClicks(ctx: QueryCtx, code: string, cycle: string): Promise<number> {
  const rows = await ctx.db
    .query("linkTotals")
    .withIndex("by_code_cycle_shard", (q) => q.eq("code", code).eq("cycle", cycle))
    .collect();
  return rows.reduce((sum, r) => sum + r.units, 0);
}
