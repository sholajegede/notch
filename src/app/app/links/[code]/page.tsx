import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breakdowns, DayChart, SampleNote } from "@/components/charts";
import { CopyButton, LinkSettings } from "@/components/controls";
import { currentOwner } from "@/lib/auth";
import { convex, serverKey } from "@/lib/convex";
import { n, stamp } from "@/lib/format";
import { countryName, flag } from "@/lib/geo";
import { site } from "@/lib/site";
import { api } from "../../../../../convex/_generated/api";

export const metadata: Metadata = { title: "Link" };
export const dynamic = "force-dynamic";

export default async function LinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const owner = (await currentOwner())!;
  const page = await convex().query(api.analytics.forLink, { serverKey: serverKey(), ownerId: owner.id, code });
  if (!page) notFound();
  const { link, summary } = page;
  const short = `${site.url}/s/${link.code}`;
  const fortnight = summary.days.reduce((sum, d) => sum + d.count, 0);
  const topCountry = summary.countries.find((c) => c.name !== "Unknown");

  return (
    <main className="page">
      <p className="eyebrow"><Link href="/app#links">← All links</Link></p>
      <h1>{link.title ?? link.code}</h1>
      <p className="sub">
        <a href={short}>{short.replace(/^https?:\/\//, "")}</a> → <span className="dest-text">{link.url}</span>
      </p>
      <div className="actions">
        <CopyButton text={short} />
        <a className="btn light small" href={`/qr/${link.code}`} download={`notch-${link.code}.svg`}>Download QR</a>
        {link.disabled && <span className="badge warn">This link is off</span>}
      </div>

      <div className="tiles four">
        <div className="tile a"><span className="label">This month</span><span className="value">{n(page.clicksThisCycle)}</span><span className="note">{page.cycle}, after bot corrections</span></div>
        <div className="tile d"><span className="label">Last 14 days</span><span className="value">{n(fortnight)}{page.truncated ? "+" : ""}</span><span className="note">{page.truncated ? "from the latest 2,000 clicks" : "all recorded clicks"}</span></div>
        <div className="tile b"><span className="label">Top country</span><span className="value small">{topCountry ? `${flag(topCountry.name)} ${countryName(topCountry.name)}` : "–"}</span><span className="note">{topCountry ? `${n(topCountry.count)} clicks` : "no place data yet"}</span></div>
        <div className="tile c"><span className="label">Made</span><span className="value small">{new Date(link.createdAt).toISOString().slice(0, 10)}</span><span className="note">UTC</span></div>
      </div>

      <div className="split">
        <section className="panel">
          <h2>Clicks, last 14 days</h2>
          <DayChart days={summary.days} />
          <SampleNote summary={summary} truncated={page.truncated} />
        </section>
        <section className="panel qr-panel">
          <h2>QR code</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/qr/${link.code}`} alt={`QR code for ${short}`} />
        </section>
      </div>

      <Breakdowns summary={summary} all />

      <section className="panel">
        <h2>Latest clicks</h2>
        <p className="hint">The newest 25. No address is kept, only a place and a device.</p>
        {page.recent.length === 0 ? <p className="empty">No clicks yet. Open the short link.</p> : (
          <div className="scroll"><table className="table wide">
            <thead><tr><th>When (UTC)</th><th>Place</th><th>Device</th><th>Browser</th><th>Referrer</th></tr></thead>
            <tbody>
              {page.recent.map((c, i) => (
                <tr key={i}>
                  <td className="mono">{stamp(c.at)}</td>
                  <td>{c.country ? `${flag(c.country)} ${c.city ? `${c.city}, ` : ""}${countryName(c.country)}` : "Unknown"}</td>
                  <td>{c.device ?? "Unknown"}{c.os ? ` · ${c.os}` : ""}</td>
                  <td>{c.browser ?? "Unknown"}</td>
                  <td>{c.referrer ?? "Direct"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="panel">
        <h2>Settings</h2>
        <p className="hint">Change the name or where the link goes. Turning a link off keeps its history. Its clicks stop counting, and so does its bill.</p>
        <LinkSettings code={link.code} title={link.title} url={link.url} disabled={link.disabled} />
      </section>
    </main>
  );
}
