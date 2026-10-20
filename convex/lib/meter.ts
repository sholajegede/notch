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

/** A Kinde management token from a machine-to-machine app. It carries the create:meter_usage scope. */
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

async function api(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${domain()}/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await managementToken()}`, "content-type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 429) throw new Error("Kinde is rate limiting this app (429).");
  if (!response.ok) throw new Error(`Kinde answered ${response.status}.`);
  return response;
}

/** True when an error means the provider asked us to slow down. */
export const isRateLimit = (error: unknown): boolean => error instanceof Error && error.message.includes("(429)");

export function kindeMeter(billing: { agreementId: string; featureCode: string }): Meter {
  return {
    async read(cycle) {
      // Kinde returns the current cycle unless asked for all of them. Another cycle cannot be read this way.
      if (cycle !== cycleOf(Date.now())) return null;
      const query = new URLSearchParams({ customer_agreement_id: billing.agreementId, billing_feature_code: billing.featureCode });
      const response = await api(`/billing/meter_usage?${query}`);
      return findUsage(await response.json());
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
