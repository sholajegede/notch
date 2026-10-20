import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Kinde sends each webhook as a signed JWT in the request body.
 * The signature is checked against the keys Kinde publishes for your domain.
 */

export const issuer = () => (process.env.KINDE_ISSUER_URL ?? "").replace(/\/$/, "");
export const kindeReady = () => Boolean(issuer() && process.env.KINDE_CLIENT_ID);

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
/** The signing keys a Kinde domain publishes. Each set is fetched once and cached by jose. */
const keysFor = (domain: string) => {
  let set = keySets.get(domain);
  if (!set) keySets.set(domain, (set = createRemoteJWKSet(new URL(`${domain}/.well-known/jwks`))));
  return set;
};
const jwks = () => keysFor(issuer());

export interface KindeEvent {
  type: string;
  eventId: string;
  occurredAt: Date;
  payload: JWTPayload;
}

export async function verifyWebhook(token: string, domain = issuer()): Promise<KindeEvent> {
  if (!domain) throw new Error("KINDE_ISSUER_URL is not set.");
  const { payload } = await jwtVerify(token.trim(), keysFor(domain.replace(/\/$/, "")));
  const type = typeof payload.type === "string" ? payload.type : "";
  if (!type) throw new Error("The event has no type.");
  const stamp = payload.event_timestamp ?? payload.timestamp;
  const occurredAt = typeof stamp === "string" || typeof stamp === "number" ? new Date(stamp) : new Date();
  return {
    type,
    eventId: typeof payload.event_id === "string" ? payload.event_id : "",
    occurredAt: Number.isNaN(+occurredAt) ? new Date() : occurredAt,
    payload,
  };
}

/** Check a Kinde access token from the CLI or the API. Returns the user id. */
export async function verifyAccessToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, jwks(), { issuer: issuer() });
  if (!payload.sub) throw new Error("The token has no subject.");
  return payload.sub;
}

/** The email of the user who holds this access token, from Kinde's user profile endpoint. */
export async function profileEmail(token: string): Promise<string | null> {
  try {
    const response = await fetch(`${issuer()}/oauth2/v2/user_profile`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const profile = (await response.json()) as { email?: unknown };
    return typeof profile.email === "string" ? profile.email : null;
  } catch {
    return null;
  }
}
