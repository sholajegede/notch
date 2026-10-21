import type { QueryCtx } from "../_generated/server";

/** The moment this account's billing agreement started, or undefined when cycles follow the calendar month. */
export async function anchorOf(ctx: Pick<QueryCtx, "db">, ownerId: string): Promise<number | undefined> {
  const billing = await ctx.db.query("billing").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).unique();
  return billing?.cycleStart;
}
