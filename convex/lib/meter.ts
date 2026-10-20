import { cycleOf } from "./core";

/** The provider's meter for one account and feature. */
export interface Meter {
  /** The total the provider holds for the cycle, or null when it cannot say. */
  read(cycle: string): Promise<number | null>;
  /**
   * Set the total. This is always an absolute write: sending it twice leaves the same total.
   * A delta write adds to the total, so a retried delta can count twice.
   */
  set(cycle: string, value: number): Promise<void>;
}

const domain = () => (process.env.KINDE_DOMAIN ?? "").replace(/\/$/, "");

let cached: { token: string; expiresAt: number } | null = null;

/** A Kinde management token from a machine-to-machine app. It carries the create:meter_usage and read:meter_usage scopes. */
async function managementToken(): Promise<string> {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const response = await fetch(`${domain()}/oauth2/token`, {
    signal: AbortSignal.timeout(10_000),
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.KINDE_M2M_CLIENT_ID ?? "",
      client_secret: process.env.KINDE_M2M_CLIENT_SECRET ?? "",
      audience: `${domain()}/api`,
    }),
  });
  if (!response.ok) throw new Error(`Kinde refused the machine token (${response.status}).`);
  const body = (await response.json()) as { access_token: string; expires_in?: number };
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** Find the running total in a response. The shape of the read endpoint is not in Kinde's docs, so look for the field by name. */
export function findUsage(body: unknown): number | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const value = record.current_usage;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  for (const child of Object.values(record)) {
    const found = findUsage(child);
    if (found !== null) return found;
  }
  return null;
}

async function api(path: string, init?: RequestInit, retried = false): Promise<Response> {
  const response = await fetch(`${domain()}/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await managementToken()}`, "content-type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 429) throw new Error("Kinde is rate limiting this app (429).");
  // A token made before a scope was added keeps the old scopes. Fetch a new one once.
  if (response.status === 403 && !retried) {
    cached = null;
    return api(path, init, true);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`Kinde answered ${response.status}${detail ? `: ${detail}` : "."}`);
  }
  return response;
}

/** True when an error means the provider asked us to slow down. */
export const isRateLimit = (error: unknown): boolean => error instanceof Error && error.message.includes("(429)");

/** For testing only: add to the provider's total with a delta write, as a report that was counted twice would. */
export async function addToKindeMeter(billing: { agreementId: string; featureCode: string }, amount: number): Promise<void> {
  await api("/billing/meter_usage", {
    method: "POST",
    body: JSON.stringify({
      customer_agreement_id: billing.agreementId,
      billing_feature_code: billing.featureCode,
      meter_value: String(amount),
      meter_type_code: "delta",
    }),
  });
}

/**
 * For testing only: write a total dated in another cycle, then read the meter back two ways.
 * It shows how Kinde treats a write for a cycle that has ended.
 */
export async function probeBackdate(billing: { agreementId: string; featureCode: string }, value: number, date: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const written = await api("/billing/meter_usage", {
      method: "POST",
      body: JSON.stringify({
        customer_agreement_id: billing.agreementId,
        billing_feature_code: billing.featureCode,
        meter_value: String(value),
        meter_type_code: "absolute",
        meter_usage_timestamp: new Date(`${date}T12:00:00Z`).toISOString(),
      }),
    });
    out.write = `ok ${(await written.text()).slice(0, 300)}`;
  } catch (error) {
    out.write = error instanceof Error ? error.message : "failed";
  }
  const base = new URLSearchParams({
    customer_agreement_id: billing.agreementId,
    agreement_id: billing.agreementId,
    billing_feature_code: billing.featureCode,
    feature_code: billing.featureCode,
  });
  for (const [name, extra] of [["currentCycleRead", ""], ["allCyclesRead", "&all_cycles=true"]] as const) {
    try {
      const body = (await (await api(`/billing/meter_usage?${base}${extra}`)).json()) as { meter_usages?: { meter_value?: number; meter_usage_timestamp?: string }[]; has_more?: boolean } & Record<string, unknown>;
      const records = body.meter_usages ?? [];
      const dated = records.filter((r) => (r.meter_usage_timestamp ?? "").startsWith(date.slice(0, 7)));
      const { meter_usages: _ignored, ...rest } = body;
      void _ignored;
      out[name] = JSON.stringify({ records: records.length, hasMore: body.has_more ?? null, recordsInTheBackdatedMonth: dated, otherFields: rest });
    } catch (error) {
      out[name] = error instanceof Error ? error.message : "failed";
    }
  }
  return out;
}

/**
 * For testing only: send many absolute writes at once with the total the meter already holds, and count the answers.
 * It shows whether Kinde throttles, at what rate, and what the 429 answer carries. The total does not change.
 */
export async function probeBurst(billing: { agreementId: string; featureCode: string }, count: number, parallel: number): Promise<Record<string, unknown>> {
  const token = await managementToken();
  const current = await kindeMeter(billing).read(cycleOf(Date.now()));
  if (current === null) return { error: "Could not read the current total." };
  const answers: Record<string, number> = {};
  let retryAfter: string | null = null;
  let sample: string | null = null;
  let sent = 0;
  const started = Date.now();
  const worker = async () => {
    while (sent < count) {
      sent++;
      try {
        const response = await fetch(`${domain()}/api/v1/billing/meter_usage`, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            customer_agreement_id: billing.agreementId,
            billing_feature_code: billing.featureCode,
            meter_value: String(current),
            meter_type_code: "absolute",
          }),
        });
        answers[String(response.status)] = (answers[String(response.status)] ?? 0) + 1;
        if (response.status === 429) {
          retryAfter = retryAfter ?? response.headers.get("retry-after");
          sample = sample ?? (await response.text()).slice(0, 200);
        }
      } catch {
        answers.failed = (answers.failed ?? 0) + 1;
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return { total: current, requests: count, parallel, seconds: Math.round((Date.now() - started) / 100) / 10, answers, retryAfter, sample429: sample };
}

export function kindeMeter(billing: { agreementId: string; featureCode: string }): Meter {
  return {
    async read(cycle) {
      // Kinde returns the current cycle unless asked for all of them. Another cycle cannot be read this way.
      if (cycle !== cycleOf(Date.now())) return null;
      // The read endpoint's parameter names are not in Kinde's docs. The write uses billing_feature_code, and the read asked for "the feature code". Send both spellings.
      const query = new URLSearchParams({
        customer_agreement_id: billing.agreementId,
        agreement_id: billing.agreementId,
        billing_feature_code: billing.featureCode,
        feature_code: billing.featureCode,
      });
      const response = await api(`/billing/meter_usage?${query}`);
      const body = await response.json();
      const found = findUsage(body);
      if (found === null) throw new Error(`Kinde sent no current_usage field. It sent: ${JSON.stringify(body).slice(0, 200)}`);
      return found;
    },
    async set(_cycle, value) {
      await api("/billing/meter_usage", {
        method: "POST",
        body: JSON.stringify({
          customer_agreement_id: billing.agreementId,
          billing_feature_code: billing.featureCode,
          meter_value: String(value),
          meter_type_code: "absolute",
        }),
      });
    },
  };
}
