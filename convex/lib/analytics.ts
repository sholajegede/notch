/**
 * Turn a list of clicks into the small summary the dashboard shows.
 * It is pure: the same clicks give the same summary, so it is easy to test.
 */

export interface ClickRow {
  at: number;
  country?: string;
  region?: string;
  city?: string;
  device?: string;
  browser?: string;
  os?: string;
  referrer?: string;
}

export interface Count {
  name: string;
  count: number;
}

export interface Summary {
  /** How many clicks the summary was made from. */
  sample: number;
  /** The time of the oldest click in the sample, or null when there is none. */
  since: number | null;
  /** Clicks for each UTC day, oldest first, with days that had no clicks included as zero. */
  days: { day: string; count: number }[];
  countries: Count[];
  regions: Count[];
  cities: Count[];
  devices: Count[];
  browsers: Count[];
  systems: Count[];
  referrers: Count[];
}

/** The most recent clicks that a summary reads. Older clicks stay in the ledger but are not in the charts. */
export const SAMPLE = 2000;
const DAY = 86_400_000;
const UNKNOWN = "Unknown";

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function tally(values: string[], top: number): Count[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, top);
}

export function summarise(rows: ClickRow[], now: number, options: { days?: number; top?: number } = {}): Summary {
  const days = options.days ?? 14;
  const top = options.top ?? 8;
  const perDay = new Map<string, number>();
  for (const row of rows) perDay.set(dayOf(row.at), (perDay.get(dayOf(row.at)) ?? 0) + 1);
  const series: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayOf(now - i * DAY);
    series.push({ day, count: perDay.get(day) ?? 0 });
  }
  return {
    sample: rows.length,
    since: rows.length === 0 ? null : rows.reduce((oldest, row) => Math.min(oldest, row.at), rows[0].at),
    days: series,
    countries: tally(rows.map((r) => r.country || UNKNOWN), top),
    regions: tally(rows.map((r) => (r.region ? `${r.country || "?"}-${r.region}` : UNKNOWN)), top),
    cities: tally(rows.map((r) => (r.city ? `${r.city}${r.country ? `, ${r.country}` : ""}` : UNKNOWN)), top),
    devices: tally(rows.map((r) => r.device || UNKNOWN), top),
    browsers: tally(rows.map((r) => r.browser || UNKNOWN), top),
    systems: tally(rows.map((r) => r.os || UNKNOWN), top),
    referrers: tally(rows.map((r) => r.referrer || "Direct"), top),
  };
}
