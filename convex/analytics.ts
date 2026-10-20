import { v } from "convex/values";
import { query } from "./_generated/server";
import { cycleOf } from "./lib/core";
import { SAMPLE, summarise, type ClickRow } from "./lib/analytics";
import { guard } from "./lib/guard";
import { linkClicks } from "./lib/totals";

const pick = (c: {
  at: number;
  code: string;
  country?: string;
  region?: string;
  city?: string;
  device?: string;
  browser?: string;
  os?: string;
  referrer?: string;
}): ClickRow & { code: string } => ({
  at: c.at,
  code: c.code,
  country: c.country,
  region: c.region,
  city: c.city,
  device: c.device,
  browser: c.browser,
  os: c.os,
  referrer: c.referrer,
});

/** Everything one link's page shows. The charts read the latest clicks only, so the read stays small. */
export const forLink = query({
  args: { serverKey: v.string(), ownerId: v.string(), code: v.string() },
  handler: async (ctx, { serverKey, ownerId, code }) => {
    guard(serverKey);
    const link = await ctx.db.query("links").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (!link || link.ownerId !== ownerId) return null;
    const cycle = cycleOf(Date.now());
    const rows = (await ctx.db.query("clicks").withIndex("by_code_at", (q) => q.eq("code", code)).order("desc").take(SAMPLE)).map(pick);
    return {
      link: { code: link.code, url: link.url, title: link.title ?? null, disabled: link.disabled === true, createdAt: link.createdAt },
      cycle,
      clicksThisCycle: await linkClicks(ctx, code, cycle),
      truncated: rows.length === SAMPLE,
      summary: summarise(rows, Date.now()),
      recent: rows.slice(0, 25),
    };
  },
});

/** The same summary across all of an account's links. */
export const forAccount = query({
  args: { serverKey: v.string(), ownerId: v.string() },
  handler: async (ctx, { serverKey, ownerId }) => {
    guard(serverKey);
    const rows = (await ctx.db.query("clicks").withIndex("by_owner_at", (q) => q.eq("ownerId", ownerId)).order("desc").take(SAMPLE)).map(pick);
    return { truncated: rows.length === SAMPLE, summary: summarise(rows, Date.now()), recent: rows.slice(0, 12) };
  },
});
