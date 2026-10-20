import { Banner, Footer, Nav } from "@/components/chrome";
import { kindeReady } from "@/lib/kinde";
import { signInHref } from "@/lib/auth";

/** A block of square pixels, in the look of a 1-bit sprite. The pattern is fixed, so the page renders the same every time. */
function Pixels({ cols, rows, color, className }: { cols: number; rows: number; color: string; className: string }) {
  const cells = [];
  for (let i = 0; i < cols * rows; i++) {
    const hash = (i * 2654435761) >>> 0;
    cells.push(<i key={i} style={{ background: hash % 7 < 2 ? color : "transparent" }} />);
  }
  return (
    <div className={`pixels ${className}`} aria-hidden="true" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {cells}
    </div>
  );
}

const failures = [
  { n: "01", title: "Counted twice", body: "A report times out, so your app sends it again. The provider adds it a second time, and the customer pays too much." },
  { n: "02", title: "Never sent", body: "The click happened, but the report failed. Nobody notices, and you are paid too little." },
  { n: "03", title: "Removed too late", body: "Ten minutes after a click was reported, you find out it was a bot. The meter still holds it." },
  { n: "04", title: "Late and closed", body: "A click arrives after the billing cycle has ended. There is no clean place to put it." },
];

const steps = [
  { title: "Make a link", body: "Paste any link. You get a short link and a QR code." },
  { title: "Open it", body: "Click the short link a few times. Each click is one line in the ledger." },
  { title: "Break the meter", body: "Add extra usage to the built-in meter, the way a repeated report would." },
  { title: "Reconcile", body: "Notch finds the difference, fixes it, reads it back, and keeps the proof." },
];

const questions = [
  { q: "Why not just add one to the meter on every click?", a: "Because a retry would add it twice, and a failed call would lose it. Notch records the click in its own ledger first. Then it sends the total, which is safe to send again." },
  { q: "What happens to bot clicks?", a: "A click is counted when it happens. A moment later, Notch checks it. If it was a bot, a new line with minus one is added. The original line stays, so you can see what happened and why the total changed." },
  { q: "Can I trust the number if my own code has a bug?", a: "That is what the reconciler is for. Every night it reads the whole ledger, compares it with what the provider holds, and repairs any difference. It also checks its own running totals against the ledger." },
  { q: "Do I need a billing account to try it?", a: "No. Without Kinde settings, Notch uses a built-in meter, so you can run the whole loop on your own machine. Connect a Kinde agreement when you want real invoices." },
];

export default function Home() {
  const href = kindeReady() ? signInHref() : "/app";
  return (
    <>
      <header className="hero">
        <Banner />
        <Nav href={href} />
        <div className="wrap hero-body">
          <h1>Short links and QR codes with a bill you can check.</h1>
          <p className="lead">
            Notch charges by the click. It keeps its own record of every click, sends the total to your billing provider, and checks
            that the number on the invoice is the number of clicks that really happened.
          </p>
          <div className="row">
            <a className="btn" href={href}>Make a link</a>
            <a className="btn light" href="#try">See it prove a bill</a>
          </div>
        </div>
        <div className="art" aria-hidden="true">
          <div className="pill y s1" />
          <div className="pill p s2" />
          <div className="pill y s3" />
          <div className="pill p s4" />
          <Pixels cols={22} rows={14} color="#a66cff" className="px1" />
          <Pixels cols={16} rows={9} color="#17b6e8" className="px2" />
        </div>
      </header>

      <div className="wrap">
        <div className="strip">
          <span><strong>Each click counted once</strong>The same click can never be added twice.</span>
          <span><strong>A mistake is a new line</strong>Nothing is edited or deleted.</span>
          <span><strong>The bill is proven</strong>Every night, and whenever you ask.</span>
        </div>
      </div>

      <section className="section" id="problem">
        <div className="wrap">
          <div className="split">
            <h2 className="display">Your invoice says 1,204 clicks. Your ledger says 1,198.</h2>
            <p className="lead-2">
              Usage billing goes wrong in four quiet ways. Each one gives the customer a number that is wrong, and gives you a
              number you cannot prove.
            </p>
          </div>
          <div className="fail-grid">
            {failures.map((f) => (
              <div className="fail" key={f.n}>
                <span className="n">{f.n}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section tight" id="how">
        <div className="wrap trio">
          <div className="side">
            <h2 className="display">Record, report, prove.</h2>
            <p>Three small parts. Each one does one job, and each one is safe to run again.</p>
          </div>
          <div className="cards">
            <div className="card lav wide">
              <span className="tag">notch ledger</span>
              <h3>Every click is one line, written once.</h3>
              <p>Each click has a key. If the same key arrives twice, the ledger adds nothing. If a click turns out to be a bot, Notch adds a new line with minus one. Nothing is edited or deleted.</p>
              <ul>
                <li>A correction goes to the cycle of the click it undoes</li>
                <li>Totals stay fast, however many clicks there are</li>
              </ul>
              <div className="shape" />
            </div>
            <div className="card cy">
              <span className="tag">notch reporter</span>
              <h3>Send the total, not the click.</h3>
              <p>Once a minute, Notch sets the provider&apos;s meter to the ledger total. A total can be sent twice with no harm. If a report fails, the cycle stays marked, and the next minute sends the newest total.</p>
              <div className="shape" />
            </div>
            <div className="card li">
              <span className="tag">notch reconciler</span>
              <h3>Prove it, then fix it.</h3>
              <p>Every night, and on demand, Notch compares the ledger, what it sent, and what the provider holds. If they differ, it repairs the meter, reads it back, and keeps the evidence.</p>
              <div className="shape" />
            </div>
          </div>
        </div>
      </section>

      <section className="section tight" id="try">
        <div className="wrap">
          <div className="split">
            <h2 className="display">Watch it prove a bill in two minutes.</h2>
            <p className="lead-2">No billing account needed. Notch comes with a built-in meter that you can break on purpose.</p>
          </div>
          <div className="steps">
            {steps.map((s, i) => (
              <div className="step" key={s.title}>
                <span className="num">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section tight" id="cli">
        <div className="wrap">
          <div className="split">
            <h2 className="display">For people who print QR codes. For people who script them.</h2>
            <p className="lead-2">Put a QR code on a menu, a flyer or an invite, and watch the clicks. Or run everything from a terminal, with a --json form on every command for scripts and agents.</p>
          </div>
          <div className="terminal" style={{ marginTop: 40 }}>
            <pre>
<span className="dim">$ </span>notch shorten https://example.com/menu{"\n"}
<span className="good">https://notch.example/s/k3Fm9Qz</span>{"\n"}
<span className="dim">(a QR code prints here)</span>{"\n\n"}
<span className="dim">$ </span>notch reconcile{"\n"}
<span className="cy">2026-10</span>  ledger 1,198 · sent 1,198 · meter 1,204  <span className="warn">over-billed</span>{"\n"}
        cause   The provider total moved without a report from this app.{"\n"}
        repair  set to 1,198, read back and confirmed{"\n\n"}
<span className="dim">$ </span>notch reconcile{"\n"}
<span className="cy">2026-10</span>  ledger 1,198 · sent 1,198 · meter 1,198  <span className="good">match</span>
            </pre>
          </div>
          <p className="eyebrow" style={{ marginTop: 12 }}>Example output</p>
        </div>
      </section>

      <section className="section tight" id="faq">
        <div className="wrap">
          <h2 className="display">Questions</h2>
          <div className="faq">
            {questions.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="cta">
        <div className="wrap">
          <h2 className="display">Make your first link.</h2>
          <a className="btn" href={href}>Get started</a>
        </div>
      </section>
      <Footer />
    </>
  );
}
