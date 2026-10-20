import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import QRCode from "qrcode";
import { call, CliError } from "./api";
import { configPath, forget, serverUrl } from "./config";
import { login } from "./login";

declare const NOTCH_VERSION: string;

const HELP = `notch ${NOTCH_VERSION}. Every click, counted once.

Usage
  notch login                       Sign in with Kinde (a code in your browser)
  notch shorten <url>               Make a short link and print its QR code
  notch links                       List your links and their clicks
  notch ledger                      Show the ledger for this cycle
  notch tail                        Watch new ledger lines as they are written
  notch reconcile                   Compare the ledger, what was sent, and the provider's meter. Repair and prove.
  notch connect --agreement <id>    Choose the Kinde billing agreement to report to
  notch backfill <file.json>        Send late clicks: [{ "key": "...", "code": "...", "at": 1760000000000 }]
  notch whoami                      Show your account
  notch logout                      Remove the sign-in from this computer

Only with the built-in meter (no Kinde billing):
  notch drift [--amount 6]          Count extra on the meter, as a repeated report would
  notch fail [--count 2]            Make the next reports fail, as an outage would

Everywhere
  --json             One JSON object for each result (tail writes one for each line)
  --server <url>     The Notch server (or NOTCH_URL)
  --feature <code>   With connect: the Kinde feature code (default: clicks)
  --no-qr            With shorten: do not print the QR code

Exit codes: 0 done, 1 failed, 2 wrong usage, 3 not signed in, 4 reconcile left a difference it could not fix, 130 stopped.`;

const options = {
  json: { type: "boolean" },
  server: { type: "string" },
  agreement: { type: "string" },
  feature: { type: "string" },
  amount: { type: "string" },
  count: { type: "string" },
  "no-qr": { type: "boolean" },
  "no-browser": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

interface Entry { entryKey: string; units: number; kind: "click" | "correction"; reason: string | null; code: string | null; eventAt: number }
interface Overview {
  cycle: string;
  total: number;
  links: { code: string; url: string; clicks: number; short_url?: string }[];
  entries: Entry[];
  billing: { agreementId: string; featureCode: string } | null;
}
interface Result {
  cycle: string;
  verdict: "match" | "over_billed" | "under_billed" | "closed_cycle_drift" | "unreadable";
  cause: string;
  ledger: number;
  lastSent: number | null;
  provider: number | null;
  repaired: boolean;
  confirmed: boolean | null;
  totalsOk: boolean | null;
}

const usage = (message: string) => new CliError(`${message}\nRun: notch --help`, 2);
const n = (value: number | null) => (value === null ? "–" : value.toLocaleString("en-US"));
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const label: Record<Result["verdict"], string> = {
  match: "match",
  over_billed: "over-billed",
  under_billed: "under-billed",
  closed_cycle_drift: "closed cycle, meter not changed",
  unreadable: "meter could not be read",
};
const line = (e: Entry) =>
  `${clock(e.eventAt)}  ${(e.code ?? "").padEnd(8)} ${(e.units > 0 ? `+${e.units}` : `${e.units}`).padStart(3)}  ${e.kind === "correction" ? `correction (${e.reason ?? "no reason"})` : "click"}`;

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw usage(error instanceof Error ? error.message : String(error));
  }
  const { values: flag, positionals } = parsed;
  const [command, ...rest] = positionals;
  const json = Boolean(flag.json);
  const out = (human: string, data?: unknown) => console.log(json ? JSON.stringify(data ?? { message: human }) : human);
  const say = (text: string) => (json ? console.error(text) : console.log(text));
  const server = flag.server;

  if (flag.version) return (console.log(NOTCH_VERSION), 0);
  if (flag.help || !command || command === "help") return (console.log(HELP), 0);

  switch (command) {
    case "login": {
      const result = await login({ server, browser: !flag["no-browser"], say });
      const me = await call<{ email: string | null; id: string }>("/api/v1/me", { server });
      out(
        result.mode === "local" ? `Signed in to the local server at ${result.server} as the local account.` : `Signed in as ${me.data.email ?? me.data.id}.`,
        { signed_in: true, server: result.server, mode: result.mode },
      );
      return 0;
    }

    case "logout": {
      const removed = forget();
      out(removed ? "Signed out. The sign-in is removed from this computer." : "You were not signed in.", { signed_out: removed });
      return 0;
    }

    case "whoami": {
      const { data } = await call<{ id: string; email: string | null; cycle: string; clicks: number; connected: boolean }>("/api/v1/me", { server });
      out(
        `${data.email ?? data.id}. ${n(data.clicks)} clicks in ${data.cycle}. ${data.connected ? "A billing agreement is connected." : "No billing agreement is connected."}\nServer: ${serverUrl(server)}\nSign-in: ${configPath()}`,
        { ...data, server: serverUrl(server) },
      );
      return 0;
    }

    case "shorten": {
      const url = rest[0];
      if (!url) throw usage("Give the link, for example: notch shorten https://example.com/menu");
      const { data } = await call<{ code: string; url: string; short_url: string; qr_url: string }>("/api/v1/links", { method: "POST", server, body: { url } });
      if (json) return (console.log(JSON.stringify(data)), 0);
      console.log(data.short_url);
      if (!flag["no-qr"]) console.log(await QRCode.toString(data.short_url, { type: "terminal", small: true }));
      return 0;
    }

    case "links": {
      const { data } = await call<{ links: (Overview["links"][number] & { short_url: string })[] }>("/api/v1/links", { server });
      if (json) return (console.log(JSON.stringify(data)), 0);
      if (data.links.length === 0) return (console.log("No links yet. Make one: notch shorten <url>"), 0);
      for (const l of data.links) console.log(`${String(l.clicks).padStart(6)}  ${l.short_url}  ${l.url}`);
      return 0;
    }

    case "ledger": {
      const { data } = await call<Overview>("/api/v1/ledger", { server });
      if (json) return (console.log(JSON.stringify(data)), 0);
      console.log(`${data.cycle}: ${n(data.total)} clicks after corrections`);
      for (const e of data.entries) console.log(line(e));
      return 0;
    }

    case "tail": {
      const seen = new Set<string>();
      let first = true;
      const stop = () => process.exit(130);
      process.on("SIGINT", stop);
      if (!json) console.log("Watching the ledger. Press Ctrl+C to stop.");
      for (;;) {
        const { data } = await call<Overview>("/api/v1/ledger", { server });
        const fresh = data.entries.filter((e) => !seen.has(e.entryKey)).reverse();
        for (const e of fresh) {
          seen.add(e.entryKey);
          if (!first) console.log(json ? JSON.stringify(e) : line(e));
        }
        first = false;
        await wait(2000);
      }
    }

    case "reconcile": {
      const { data } = await call<{ results: Result[] }>("/api/v1/reconcile", { method: "POST", server });
      if (json) {
        console.log(JSON.stringify(data));
      } else {
        for (const r of data.results) {
          console.log(`${r.cycle}  ledger ${n(r.ledger)} · sent ${n(r.lastSent)} · meter ${n(r.provider)}  ${label[r.verdict]}`);
          if (r.verdict !== "match") console.log(`        cause   ${r.cause}`);
          if (r.totalsOk === false) console.log("        totals  the running totals were wrong and were rebuilt from the ledger");
          if (r.repaired) console.log(`        repair  set to ${n(r.ledger)}, ${r.confirmed ? "read back and confirmed" : "read back and NOT confirmed"}`);
        }
      }
      const unresolved = data.results.some((r) => r.verdict === "closed_cycle_drift" || r.verdict === "unreadable" || (r.repaired && !r.confirmed));
      return unresolved ? 4 : 0;
    }

    case "connect": {
      if (!flag.agreement) throw usage("Give the Kinde agreement id, for example: notch connect --agreement agr_…");
      const { data } = await call<{ connected: boolean; feature_code: string }>("/api/v1/billing", {
        method: "POST",
        server,
        body: { agreement_id: flag.agreement, feature_code: flag.feature },
      });
      out(`Connected. Clicks are reported to feature "${data.feature_code}".`, data);
      return 0;
    }

    case "backfill": {
      const file = rest[0];
      if (!file) throw usage("Give a JSON file of clicks, for example: notch backfill late.json");
      let clicks: unknown;
      try {
        clicks = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        throw usage(`Could not read ${file} as JSON.`);
      }
      const { data } = await call<{ inserted: number; duplicates: number; inClosedCycle: number }>("/api/v1/clicks/backfill", { method: "POST", server, body: { clicks } });
      out(`Added ${data.inserted}. Refused ${data.duplicates} that were already counted. ${data.inClosedCycle} fell in a closed cycle, so run: notch reconcile`, data);
      return 0;
    }

    case "drift": {
      const amount = flag.amount === undefined ? 6 : Number(flag.amount);
      if (!Number.isInteger(amount)) throw usage("--amount takes a whole number.");
      await call("/api/v1/sim/drift", { method: "POST", server, body: { amount } });
      out(`The built-in meter now holds ${amount} more than the ledger says. Run: notch reconcile`, { drifted: amount });
      return 0;
    }

    case "fail": {
      const count = flag.count === undefined ? 2 : Number(flag.count);
      if (!Number.isInteger(count)) throw usage("--count takes a whole number.");
      await call("/api/v1/sim/fail", { method: "POST", server, body: { count } });
      out(`The next ${count} reports to the built-in meter will fail.`, { failing: count });
      return 0;
    }

    default:
      throw usage(`"${command}" is not a notch command.`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    const code = error instanceof CliError ? error.code : 1;
    const message = error instanceof Error ? error.message : String(error);
    if (process.argv.includes("--json")) console.log(JSON.stringify({ error: message, code }));
    else console.error(message);
    process.exit(code);
  },
);
