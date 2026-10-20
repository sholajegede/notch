/**
 * The rules of Notch that need no database. Everything here is a pure function,
 * so the same input always gives the same answer and tests can check each rule alone.
 */

/** The billing feature that counts clicks. It matches the feature code in Kinde. */
export const FEATURE = "clicks";

/** The billing cycle an event belongs to. The app picks it from the event time, in UTC. */
export const cycleOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

/** A cycle is closed when a later cycle has started. */
export const isClosed = (cycle: string, nowMs: number): boolean => cycle < cycleOf(nowMs);

/** The cycle before this one, for example 2026-10 gives 2026-09. */
export const previousCycle = (cycle: string): string => {
  const [year, month] = cycle.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
};

const BOT_AGENT =
  /bot|crawl|spider|slurp|preview|fetch|curl|wget|python-requests|headless|facebookexternalhit|embedly|monitor|uptime/i;

/** Link previews and scripts are not people. A burst of clicks from one address is not a crowd. */
export const BURST = 30;
export const looksLikeBot = (agent: string, burst: number): boolean => BOT_AGENT.test(agent) || burst >= BURST;

export type Verdict = "match" | "over_billed" | "under_billed" | "closed_cycle_drift" | "unreadable";

export interface Evidence {
  /** The total of the ledger. This is the record of what happened. */
  ledger: number;
  /** The last total this app sent to the provider for this cycle, or null if it sent none. */
  lastSent: number | null;
  /** The total the provider holds now, or null if it could not be read. */
  provider: number | null;
  closed: boolean;
  lastReportFailed: boolean;
}

export interface Decision {
  verdict: Verdict;
  cause: string;
  /** The total to set on the provider, or null when no repair is needed or possible. */
  repair: number | null;
}

/** Compare the ledger, the sent log and the provider's total, and say what to do about it. */
export function decide(e: Evidence): Decision {
  if (e.provider === null) {
    return { verdict: "unreadable", cause: "The provider total could not be read, so nothing was compared.", repair: null };
  }
  if (e.provider === e.ledger) {
    return {
      verdict: "match",
      cause: e.lastSent === e.ledger ? "The ledger, the sent log and the provider agree." : "The provider matches the ledger. The sent log is out of date.",
      repair: null,
    };
  }
  let cause: string;
  if (e.lastReportFailed) cause = "The last report failed, so the provider missed the newest change.";
  else if (e.lastSent === null) cause = "This app never sent a total for this cycle.";
  else if (e.provider !== e.lastSent) cause = "The provider total moved without a report from this app. A report was counted twice, or something else wrote to the meter.";
  else cause = "The ledger changed after the last report. A late click or a correction arrived.";
  if (e.closed) {
    return { verdict: "closed_cycle_drift", cause: `${cause} The cycle is closed, so the meter was not changed.`, repair: null };
  }
  return { verdict: e.provider > e.ledger ? "over_billed" : "under_billed", cause, repair: e.ledger };
}

/** The same evidence always gives the same hash, so a repeat run adds no new record. */
export const evidenceHash = (
  cycle: string,
  e: Pick<Evidence, "ledger" | "lastSent" | "provider"> & { totalsOk?: boolean | null },
): string => `${cycle}|${e.ledger}|${e.lastSent ?? "none"}|${e.provider ?? "unreadable"}|${e.totalsOk ?? "unchecked"}`;

/**
 * Limits that keep each job small. A job that does too much in one run gets cut off, so every job works in pages.
 */
/** A hot account would make one row a bottleneck. Counters are split over this many rows and added on read. */
export const SHARDS = 8;
/** Ledger rows read in one page when the reconciler proves a total by scanning. */
export const SCAN_PAGE = 1000;
/** Cycles claimed by one batch of the reporter, and how many are sent at the same time. */
export const CLAIM_BATCH = 100;
export const SEND_PARALLEL = 10;
export const MAX_BATCHES = 20;
/** Accounts handled by one page of the nightly reconcile, and how many run at the same time. */
export const RECON_PAGE = 50;
export const RECON_PARALLEL = 5;
/** Limits on one account. */
export const MAX_LINKS = 1000;
export const LINKS_PER_MINUTE = 10;
