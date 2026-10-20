"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function send(path: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(path, {
    method: "POST",
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
  const run = async (path: string, body?: unknown, message?: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    const { ok, data } = await send(path, body);
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
