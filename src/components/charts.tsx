import { countryName, flag } from "@/lib/geo";
import { n, shortDay } from "@/lib/format";

export interface Count {
  name: string;
  count: number;
}
export interface Summary {
  sample: number;
  since: number | null;
  days: { day: string; count: number }[];
  countries: Count[];
  regions: Count[];
  cities: Count[];
  devices: Count[];
  browsers: Count[];
  systems: Count[];
  referrers: Count[];
}

/** Clicks for each day as plain bars. No chart library: a bar is a box with a height. */
export function DayChart({ days }: { days: { day: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  return (
    <div role="img" aria-label={`${n(total)} clicks in the last ${days.length} days`}>
      <div className="bars">
        {days.map((d) => (
          <div className="bar" key={d.day} title={`${shortDay(d.day)}: ${n(d.count)} clicks`}>
            <span className="fill" style={{ height: `${Math.max(d.count === 0 ? 0 : 4, Math.round((d.count / max) * 100))}%` }} />
          </div>
        ))}
      </div>
      <div className="bar-axis">
        <span>{shortDay(days[0].day)}</span>
        <span>{n(total)} clicks</span>
        <span>{shortDay(days[days.length - 1].day)}</span>
      </div>
    </div>
  );
}

/** One ranked list: a label, a bar that shows the share, and the count. */
export function Breakdown({ title, items, sample, kind }: { title: string; items: Count[]; sample: number; kind?: "country" }) {
  return (
    <section className="panel breakdown">
      <h3>{title}</h3>
      {items.length === 0 || sample === 0 ? (
        <p className="empty">No clicks yet.</p>
      ) : (
        <ul>
          {items.map((item) => {
            const share = Math.round((item.count / sample) * 100);
            const label = kind === "country" ? `${flag(item.name)} ${countryName(item.name)}`.trim() : item.name;
            return (
              <li key={item.name}>
                <span className="meter" style={{ width: `${Math.max(2, share)}%` }} aria-hidden="true" />
                <span className="name">{label}</span>
                <span className="count">{n(item.count)} <small>{share}%</small></span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Breakdowns({ summary, all = false }: { summary: Summary; all?: boolean }) {
  const s = summary.sample;
  return (
    <div className="breakdowns">
      <Breakdown title="Countries" items={summary.countries} sample={s} kind="country" />
      {all && <Breakdown title="Regions" items={summary.regions} sample={s} />}
      {all && <Breakdown title="Cities" items={summary.cities} sample={s} />}
      <Breakdown title="Devices" items={summary.devices} sample={s} />
      <Breakdown title="Browsers" items={summary.browsers} sample={s} />
      {all && <Breakdown title="Systems" items={summary.systems} sample={s} />}
      <Breakdown title="Referrers" items={summary.referrers} sample={s} />
    </div>
  );
}

/** Says what the charts were made from, so nobody reads them as more than they are. */
export function SampleNote({ summary, truncated }: { summary: Summary; truncated: boolean }) {
  if (summary.sample === 0) return null;
  return (
    <p className="note-line">
      {truncated ? `Made from the latest ${n(summary.sample)} clicks. Older clicks are in the ledger but not in these charts.` : `Made from all ${n(summary.sample)} recorded clicks.`}
      {" "}Place comes from the host&apos;s location headers. Where a host sends none, Notch looks it up from the address and keeps only the place, never the address.
    </p>
  );
}
