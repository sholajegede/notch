import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Banner, Footer, Nav } from "@/components/chrome";
import { ConnectForm, CopyButton, LinkForm, ReconcileButton, SimButtons } from "@/components/controls";
import { currentOwner, signInHref } from "@/lib/auth";
import { convex, serverKey, simulated } from "@/lib/convex";
import { kindeReady } from "@/lib/kinde";
import { site } from "@/lib/site";
import { api } from "../../../convex/_generated/api";

export const metadata: Metadata = { title: "Your clicks" };
export const dynamic = "force-dynamic";

const stamp = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(5, 19);
const verdictClass = (v: string) => (v === "match" ? "ok" : v === "unreadable" ? "warn" : "bad");
const verdictLabel: Record<string, string> = {
  match: "match",
  over_billed: "over-billed",
  under_billed: "under-billed",
  closed_cycle_drift: "closed cycle",
  unreadable: "unreadable",
};

export default async function Dashboard() {
  const owner = await currentOwner();
  if (!owner) {
    if (kindeReady()) redirect(signInHref());
    return (
      <>
        <Nav href="/" />
        <main className="wrap dash"><h1>Sign-in is not set up</h1><p className="sub">This server has no Kinde settings. Add them, then open this page again.</p></main>
      </>
    );
  }
  const view = await convex().query(api.ledger.overview, { serverKey: serverKey(), ownerId: owner.id });
  const lastSent = view.reports.find((r) => r.status === "sent");
  const lastRecon = view.reconciliations.find((r) => r.cycle === view.cycle);

  return (
    <>
      <Banner />
      <Nav signedIn href="/app" />
      <main className="wrap dash">
        <p className="eyebrow">{view.cycle} · {owner.email ?? owner.id}</p>
        <h1>Your clicks</h1>
        <p className="sub">The ledger is what happened. The provider&apos;s meter is a copy. Reconcile to prove they agree.</p>

        <div className="tiles">
          <div className="tile a"><span className="label">Ledger</span><span className="value">{view.total.toLocaleString("en-US")}</span><span className="note">clicks this cycle, after bot corrections</span></div>
          <div className="tile b"><span className="label">Last sent</span><span className="value">{lastSent ? lastSent.value.toLocaleString("en-US") : "–"}</span><span className="note">{view.waiting.length > 0 ? "a new total goes out within a minute" : "the provider is up to date"}</span></div>
          <div className="tile c"><span className="label">Meter at last check</span><span className="value">{lastRecon?.provider != null ? lastRecon.provider.toLocaleString("en-US") : "–"}</span><span className="note">{lastRecon ? verdictLabel[lastRecon.verdict] : "not reconciled yet"}</span></div>
        </div>

        {view.links.length === 0 && (
          <section className="panel start">
            <h2>Start here</h2>
            {simulated() ? (
              <>
                <p className="hint">Four steps show the whole idea. No billing account is needed.</p>
                <ol>
                  <li><b>Make a link</b>Paste any link below.</li>
                  <li><b>Open it</b>Click the short link two or three times.</li>
                  <li><b>Break the meter</b>Use the button at the bottom of this page.</li>
                  <li><b>Reconcile</b>Watch Notch find the gap, fix it and keep the proof.</li>
                </ol>
              </>
            ) : (
              <>
                <p className="hint">Four steps send real usage to your Kinde billing.</p>
                <ol>
                  <li><b>Connect billing</b>Add your Kinde agreement id and feature code at the bottom of this page.</li>
                  <li><b>Make a link</b>Paste any link below.</li>
                  <li><b>Open it</b>Click the short link a few times. Notch reports the total within a minute.</li>
                  <li><b>Reconcile</b>Compare the ledger with the meter and keep the proof.</li>
                </ol>
              </>
            )}
          </section>
        )}

        <section className="panel">
          <h2>Make a link</h2>
          <p className="hint">Paste a link. You get a short link and a QR code. Each click is written to the ledger.</p>
          <LinkForm />
          {view.links.length === 0 ? <p className="empty" style={{ marginTop: 16 }}>No links yet.</p> : (
            <div style={{ marginTop: 16 }}>
              {view.links.map((link) => (
                <div className="link-row" key={link.code}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/qr/${link.code}`} alt={`QR code for ${link.code}`} />
                  <div>
                    <div className="short"><a href={`/s/${link.code}`}>{site.url.replace(/^https?:\/\//, "")}/s/{link.code}</a> <CopyButton text={`${site.url}/s/${link.code}`} /></div>
                    <div className="dest">{link.url}</div>
                  </div>
                  <div className="clicks">{link.clicks.toLocaleString("en-US")}<small>clicks</small></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Reconciliation</h2>
          <p className="hint">Compares the ledger, what Notch sent, and what the provider holds. A difference is repaired with an absolute write, read back, and kept as evidence. Run it again and nothing changes once they agree.</p>
          <ReconcileButton />
          {view.review.length > 0 && <p className="error">{view.review.length} closed cycle changed after it closed. The meter was not changed. Reconcile to see the difference.</p>}
          {view.reconciliations.length === 0 ? <p className="empty" style={{ marginTop: 16 }}>No comparisons yet. Make a link, open it, then reconcile.</p> : (
            <div style={{ marginTop: 16 }}>
              {view.reconciliations.map((r) => (
                <div className="recon" key={r.id}>
                  <div className="recon-head">
                    <span className={`badge ${verdictClass(r.verdict)}`}>{verdictLabel[r.verdict] ?? r.verdict}</span>
                    {r.repaired && <span className={`badge ${r.confirmed ? "ok" : "bad"}`}>{r.confirmed ? "repaired and read back" : "repair not confirmed"}</span>}
                    <span className="badge">{r.cycle}</span>
                    <span className="when">{stamp(r.at)} UTC</span>
                  </div>
                  <div className="recon-nums">
                    <div><small>Ledger</small>{r.ledger.toLocaleString("en-US")}</div>
                    <div><small>Sent</small>{r.lastSent === null ? "–" : r.lastSent.toLocaleString("en-US")}</div>
                    <div><small>Meter</small>{r.provider === null ? "–" : r.provider.toLocaleString("en-US")}</div>
                  </div>
                  <p className="cause">{r.cause}</p>
                  <p className="cause">{r.entries} clicks and {r.corrections} corrections were read from the ledger.{r.totalsOk === false ? " The running totals were wrong and were rebuilt." : ""}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="grid2">
          <section className="panel">
            <h2>Ledger</h2>
            <p className="hint">The newest lines. Corrections have minus one and point at the click they undo.</p>
            {view.entries.length === 0 ? <p className="empty">Nothing yet. Open a short link.</p> : (
              <div className="scroll"><table className="table">
                <thead><tr><th>When (UTC)</th><th>Link</th><th className="num">Units</th><th>Note</th></tr></thead>
                <tbody>
                  {view.entries.map((e) => (
                    <tr key={e.entryKey}>
                      <td className="mono">{stamp(e.eventAt)}</td><td className="mono">{e.code}</td><td className="num">{e.units > 0 ? `+${e.units}` : e.units}</td>
                      <td>{e.kind === "correction" ? <span className="badge warn">{e.reason ?? "correction"}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>
          <section className="panel">
            <h2>Reports sent</h2>
            <p className="hint">Each report sets the provider&apos;s total. Many clicks in one minute become one report.</p>
            {view.reports.length === 0 ? <p className="empty">No reports yet.</p> : (
              <div className="scroll"><table className="table">
                <thead><tr><th>When (UTC)</th><th className="num">Total</th><th>Result</th></tr></thead>
                <tbody>
                  {view.reports.map((r, i) => (
                    <tr key={i}>
                      <td className="mono">{stamp(r.at)}</td><td className="num">{r.value}</td>
                      <td><span className={`badge ${r.status === "sent" ? "ok" : "bad"}`}>{r.status}</span> <span className="badge">{r.source}</span>{r.error ? <p className="cause">{r.error}</p> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>
        </div>

        <section className="panel">
          <h2>Billing</h2>
          <p className="hint">
            {simulated()
              ? "Notch is using its built-in meter, so it runs with no billing account. Set METER_DRIVER=kinde on the Convex deployment to report to Kinde."
              : "Notch reports to this Kinde billing agreement and feature. Find the agreement id on the user's Billing tab in Kinde."}
          </p>
          <ConnectForm current={view.billing} />
        </section>

        {simulated() && (
          <section className="panel">
            <h2>Break it on purpose</h2>
            <p className="hint">Only with the built-in meter. Count extra on the meter as a repeated report would, or fail the next reports as an outage would. Then reconcile and watch it prove and repair the total.</p>
            <SimButtons />
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
