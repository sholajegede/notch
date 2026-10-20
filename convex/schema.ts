import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  links: defineTable({
    code: v.string(),
    url: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
    /** A name for the owner to find the link by. */
    title: v.optional(v.string()),
    /** A turned-off link answers "gone" and records no click. Its history stays. */
    disabled: v.optional(v.boolean()),
  })
    .index("by_code", ["code"])
    .index("by_owner", ["ownerId"]),

  /** What was seen at the door: who clicked, kept as hashes. */
  clicks: defineTable({
    entryKey: v.string(),
    code: v.string(),
    ownerId: v.string(),
    at: v.number(),
    agent: v.string(),
    ipHash: v.string(),
    /** Where and on what the click came from. No address is kept. Missing on older clicks. */
    country: v.optional(v.string()),
    region: v.optional(v.string()),
    city: v.optional(v.string()),
    device: v.optional(v.string()),
    browser: v.optional(v.string()),
    os: v.optional(v.string()),
    referrer: v.optional(v.string()),
  })
    .index("by_entryKey", ["entryKey"])
    .index("by_ip", ["code", "ipHash", "at"])
    .index("by_code_at", ["code", "at"])
    .index("by_owner_at", ["ownerId", "at"]),

  /** The ledger. Rows are added and never edited. A correction is a new row with negative units. */
  ledger: defineTable({
    entryKey: v.string(),
    ownerId: v.string(),
    feature: v.string(),
    cycle: v.string(),
    eventAt: v.number(),
    recordedAt: v.number(),
    units: v.number(),
    kind: v.union(v.literal("click"), v.literal("correction")),
    reason: v.optional(v.string()),
    ref: v.optional(v.string()),
    code: v.optional(v.string()),
  })
    .index("by_entryKey", ["entryKey"])
    .index("by_owner_cycle", ["ownerId", "cycle", "eventAt"]),

  /**
   * Running totals for each account and cycle, split over several rows so that many clicks at once
   * do not fight over one row. The total is the sum of the rows. The ledger is still the record:
   * the reconciler checks these rows against it.
   */
  totals: defineTable({
    ownerId: v.string(),
    cycle: v.string(),
    shard: v.number(),
    units: v.number(),
    entries: v.number(),
    corrections: v.number(),
  }).index("by_owner_cycle_shard", ["ownerId", "cycle", "shard"]),

  /** Running totals for each link and cycle, split the same way. */
  linkTotals: defineTable({
    code: v.string(),
    cycle: v.string(),
    shard: v.number(),
    units: v.number(),
  }).index("by_code_cycle_shard", ["code", "cycle", "shard"]),

  /** Every account and cycle that has a ledger. The nightly reconcile walks this list in pages. */
  cycles: defineTable({
    ownerId: v.string(),
    cycle: v.string(),
  })
    .index("by_owner_cycle", ["ownerId", "cycle"])
    .index("by_cycle", ["cycle"]),

  /** Cycles whose ledger changed since the last report. The reporter claims these. */
  dirty: defineTable({
    ownerId: v.string(),
    cycle: v.string(),
    markedAt: v.number(),
  })
    .index("by_owner_cycle", ["ownerId", "cycle"])
    .index("by_marked", ["markedAt"]),

  /** Closed cycles that changed after they closed. The meter is not written for these, so a person must look. */
  review: defineTable({
    ownerId: v.string(),
    cycle: v.string(),
    since: v.number(),
  }).index("by_owner_cycle", ["ownerId", "cycle"]),

  /** The sent log. One row for each try to set the provider's total. */
  reports: defineTable({
    ownerId: v.string(),
    cycle: v.string(),
    value: v.number(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
    source: v.union(v.literal("reporter"), v.literal("reconciler")),
    at: v.number(),
  }).index("by_owner_cycle", ["ownerId", "cycle", "at"]),

  /** The evidence. One row for each distinct comparison. */
  reconciliations: defineTable({
    ownerId: v.string(),
    cycle: v.string(),
    hash: v.string(),
    ledger: v.number(),
    lastSent: v.union(v.number(), v.null()),
    provider: v.union(v.number(), v.null()),
    verdict: v.string(),
    cause: v.string(),
    repaired: v.boolean(),
    /** After a repair, the provider total was read again. True when it matched the ledger. */
    confirmed: v.union(v.boolean(), v.null()),
    /** Did the running totals match the ledger scan? Null when clicks arrived during the scan. */
    totalsOk: v.union(v.boolean(), v.null()),
    entries: v.number(),
    corrections: v.number(),
    at: v.number(),
  })
    .index("by_owner", ["ownerId", "at"])
    .index("by_hash", ["ownerId", "cycle", "hash"]),

  /** Which Kinde billing agreement this account's clicks are reported to. */
  billing: defineTable({
    ownerId: v.string(),
    agreementId: v.string(),
    featureCode: v.string(),
  }).index("by_owner", ["ownerId"]),

  /** A stand-in for the provider's meter, so Notch runs with no Kinde settings. */
  simMeter: defineTable({
    ownerId: v.string(),
    cycle: v.string(),
    value: v.number(),
    failNext: v.number(),
  }).index("by_owner_cycle", ["ownerId", "cycle"]),
});
