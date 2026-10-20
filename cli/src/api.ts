import { load, save, serverUrl, type Saved } from "./config";

export class CliError extends Error {
  constructor(
    message: string,
    public code = 1,
  ) {
    super(message);
  }
}

export const NOT_SIGNED_IN = 3;

/** Refresh the Kinde token when it ends in the next minute and a refresh token is saved. */
async function freshToken(saved: Saved): Promise<string> {
  if (process.env.NOTCH_TOKEN) return process.env.NOTCH_TOKEN;
  if (!saved.access_token) throw new CliError("You are not signed in. Run: notch login", NOT_SIGNED_IN);
  if (!saved.expires_at || saved.expires_at - 60_000 > Date.now()) return saved.access_token;
  if (!saved.refresh_token || !saved.issuer || !saved.client_id) {
    throw new CliError("Your sign-in has ended. Run: notch login", NOT_SIGNED_IN);
  }
  const response = await fetch(`${saved.issuer}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: saved.client_id, refresh_token: saved.refresh_token }),
  });
  if (!response.ok) throw new CliError("Your sign-in has ended. Run: notch login", NOT_SIGNED_IN);
  const token = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  save({
    ...saved,
    access_token: token.access_token,
    refresh_token: token.refresh_token ?? saved.refresh_token,
    expires_at: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  });
  return token.access_token;
}

export async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; server?: string } = {},
): Promise<{ status: number; data: T }> {
  const saved = load();
  const server = serverUrl(init.server);
  const token = await freshToken(saved);
  let response: Response;
  try {
    response = await fetch(`${server}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CliError(`Notch at ${server} did not answer. Check your connection, or set NOTCH_URL.`);
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (response.status === 401) throw new CliError("The server did not accept your sign-in. Run: notch login", NOT_SIGNED_IN);
  if (!response.ok && response.status !== 409) throw new CliError(data.error ?? `The server answered ${response.status}.`);
  return { status: response.status, data };
}
