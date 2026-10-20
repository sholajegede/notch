"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function send(path: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, data };
}

/** One small hook for every button: run a call, show its error, refresh the page. */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (path: string, body?: unknown, message?: string, method?: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    const { ok, data } = await send(path, body, method);
    setBusy(false);
    if (!ok) {
      setError(typeof data.error === "string" ? data.error : "That did not work.");
      return false;
    }
    if (message) setDone(message);
    router.refresh();
    return true;
  };
  return { busy, error, done, run };
}

export function LinkForm() {
  const { busy, error, run } = useAction();
  const [url, setUrl] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (await run("/api/v1/links", { url })) setUrl("");
      }}
    >
      <div className="field">
        <input type="url" required placeholder="https://example.com/your-long-link" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Link to shorten" />
        <button className="btn" disabled={busy}>{busy ? "Making…" : "Make short link"}</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export function ReconcileButton() {
  const { busy, error, run } = useAction();
  return (
    <>
      <button className="btn" disabled={busy} onClick={() => run("/api/v1/reconcile")}>{busy ? "Comparing…" : "Reconcile now"}</button>
      {error && <p className="error">{error}</p>}
    </>
  );
}

export function ConnectForm({ current }: { current: { agreementId: string; featureCode: string } | null }) {
  const { busy, error, run } = useAction();
  const [agreement, setAgreement] = useState(current?.agreementId ?? "");
  const [feature, setFeature] = useState(current?.featureCode ?? "clicks");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        await run("/api/v1/billing", { agreement_id: agreement, feature_code: feature });
      }}
    >
      <div className="field">
        <input required placeholder="Kinde agreement id" value={agreement} onChange={(e) => setAgreement(e.target.value)} aria-label="Kinde agreement id" />
        <input required placeholder="Feature code" value={feature} onChange={(e) => setFeature(e.target.value)} aria-label="Feature code" className="narrow" />
        <button className="btn light" disabled={busy}>{busy ? "Saving…" : current ? "Update" : "Connect"}</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export function SimButtons() {
  const { busy, error, done, run } = useAction();
  return (
    <>
      <div className="field">
        <button className="btn light" disabled={busy} onClick={() => run("/api/v1/sim/drift", { amount: 6 }, "Done. The meter now holds 6 more than the ledger. Scroll up and click Reconcile now.")}>Count 6 extra on the meter</button>
        <button className="btn light" disabled={busy} onClick={() => run("/api/v1/sim/fail", { count: 2 }, "Done. The next 2 reports will fail. Open a short link, then watch Reports sent.")}>Fail the next 2 reports</button>
      </div>
      {done && <p className="notice" role="status">{done}</p>}
      {error && <p className="error">{error}</p>}
    </>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn light small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* The browser blocked the copy. The link is shown on the page. */
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** Rename a link, change where it goes, and turn it off or on. */
export function LinkSettings({ code, title, url, disabled }: { code: string; title: string | null; url: string; disabled: boolean }) {
  const router = useRouter();
  const { busy, error, done, run } = useAction();
  const [sure, setSure] = useState(false);
  const [name, setName] = useState(title ?? "");
  const [destination, setDestination] = useState(url);
  const path = `/api/v1/links/${code}`;
  return (
    <div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          await run(path, { title: name, url: destination }, "Saved.", "PATCH");
        }}
      >
        <label className="lbl" htmlFor="link-name">Name</label>
        <input id="link-name" className="plain" maxLength={80} placeholder="A name you will recognise" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="lbl" htmlFor="link-dest">Where it goes</label>
        <input id="link-dest" className="plain" type="url" required value={destination} onChange={(e) => setDestination(e.target.value)} />
        <div className="field" style={{ marginTop: 16 }}>
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          <button
            type="button"
            className="btn light"
            disabled={busy}
            onClick={() =>
              run(path, { disabled: !disabled }, disabled ? "The link is on again." : "The link is off. It shows a notice and counts no clicks.", "PATCH")
            }
          >
            {disabled ? "Turn the link on" : "Turn the link off"}
          </button>
        </div>
      </form>
      <div className="danger">
        {sure ? (
          <>
            <p>Delete this link? The short link stops working and leaves your list. Its past clicks stay in the ledger, so your bill and proof still match.</p>
            <div className="field">
              <button
                type="button"
                className="btn danger-btn"
                disabled={busy}
                onClick={async () => {
                  if (await run(path, {}, undefined, "DELETE")) router.push("/app#links");
                }}
              >
                {busy ? "Deleting…" : "Yes, delete it"}
              </button>
              <button type="button" className="btn light" disabled={busy} onClick={() => setSure(false)}>Keep it</button>
            </div>
          </>
        ) : (
          <button type="button" className="btn light" onClick={() => setSure(true)}>Delete link</button>
        )}
      </div>
      {done && <p className="notice" role="status">{done}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
