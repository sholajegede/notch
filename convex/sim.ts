import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { anchorOf } from "./lib/anchor";
import { cycleOf } from "./lib/core";
import { guard } from "./lib/guard";

/**
 * A stand-in for the provider's meter. Notch uses it when METER_DRIVER is not "kinde",
 * so the whole loop runs with no billing account. The two switches below break it on purpose.
 */

export const read = internalQuery({
  args: { ownerId: v.string(), cycle: v.string() },
  handler: async (ctx, { ownerId, cycle }) => {
    const row = await ctx.db.query("simMeter").withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle)).unique();
    return row ? row.value : 0;
  },
});

export const write = internalMutation({
  args: { ownerId: v.string(), cycle: v.string(), value: v.number() },
  handler: async (ctx, { ownerId, cycle, value }) => {
    const row = await ctx.db.query("simMeter").withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle)).unique();
    if (!row) {
      await ctx.db.insert("simMeter", { ownerId, cycle, value, failNext: 0 });
      return { ok: true };
    }
    if (row.failNext > 0) {
      // Do not throw: a throw would undo this count. The caller sees the failure.
      await ctx.db.patch(row._id, { failNext: row.failNext - 1 });
      return { ok: false };
    }
    await ctx.db.patch(row._id, { value });
    return { ok: true };
  },
});

/** Move the provider's total without a report from Notch, as a counted-twice report would. */
export const drift = mutation({
  args: { serverKey: v.string(), ownerId: v.string(), amount: v.number() },
  handler: async (ctx, { serverKey, ownerId, amount }) => {
    guard(serverKey);
    const cycle = cycleOf(Date.now(), await anchorOf(ctx, ownerId));
    const row = await ctx.db.query("simMeter").withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle)).unique();
    if (row) await ctx.db.patch(row._id, { value: row.value + amount });
    else await ctx.db.insert("simMeter", { ownerId, cycle, value: amount, failNext: 0 });
    return { ok: true };
  },
});

/** Make the next reports fail, as a provider outage would. */
export const failNext = mutation({
  args: { serverKey: v.string(), ownerId: v.string(), count: v.number() },
  handler: async (ctx, { serverKey, ownerId, count }) => {
    guard(serverKey);
    const cycle = cycleOf(Date.now(), await anchorOf(ctx, ownerId));
    const row = await ctx.db.query("simMeter").withIndex("by_owner_cycle", (q) => q.eq("ownerId", ownerId).eq("cycle", cycle)).unique();
    if (row) await ctx.db.patch(row._id, { failNext: count });
    else await ctx.db.insert("simMeter", { ownerId, cycle, value: 0, failNext: count });
    return { ok: true };
  },
});
