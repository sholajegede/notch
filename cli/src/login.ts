import { spawn } from "node:child_process";
import { CliError } from "./api";
import { save, serverUrl } from "./config";

interface CliInfo {
  mode?: "kinde" | "local";
  issuer?: string;
  client_id?: string;
  token?: string;
  error?: string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // No browser on this machine. The link is printed.
  }
}

/**
 * Sign in with Kinde's device authorization flow:
 * ask Kinde for a code, show it, then poll the token endpoint until the user approves.
 */
export async function login(options: { server?: string; browser: boolean; say: (line: string) => void }) {
  const server = serverUrl(options.server);
  let info: CliInfo;
  try {
    const response = await fetch(`${server}/api/v1/cli`, { signal: AbortSignal.timeout(10_000) });
    info = (await response.json()) as CliInfo;
  } catch {
    throw new CliError(`Notch at ${server} did not answer. Check the address, or set NOTCH_URL.`);
  }

  if (info.mode === "local" && info.token) {
    save({ server, access_token: info.token });
    return { server, mode: "local" as const };
  }
  if (info.mode !== "kinde" || !info.issuer || !info.client_id) {
    throw new CliError(info.error ?? "This server does not accept CLI sign-in yet.");
  }

  const start = await fetch(`${info.issuer}/oauth2/device/auth`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: info.client_id, scope: "openid profile email offline" }),
  });
  if (!start.ok) throw new CliError(`Kinde did not start the sign-in (${start.status}).`);
  const device = (await start.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  };

  const link = device.verification_uri_complete ?? device.verification_uri;
  options.say(`Open this link and check that the code is ${device.user_code}:`);
  options.say(`  ${link}`);
  if (options.browser) openBrowser(link);
  options.say("Waiting for you to approve the sign-in…");

  let interval = (device.interval ?? 5) * 1000;
  const until = Date.now() + device.expires_in * 1000;
  while (Date.now() < until) {
    await wait(interval);
    const response = await fetch(`${info.issuer}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: info.client_id,
        device_code: device.device_code,
      }),
    });
    const token = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (token.access_token) {
      save({
        server,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
        issuer: info.issuer,
        client_id: info.client_id,
      });
      return { server, mode: "kinde" as const };
    }
    if (token.error === "slow_down") interval += 5000;
    else if (token.error === "access_denied") throw new CliError("The sign-in was refused.");
    else if (token.error === "expired_token") break;
    else if (token.error && token.error !== "authorization_pending") throw new CliError(`Kinde answered: ${token.error}.`);
  }
  throw new CliError("The code ran out before the sign-in was approved. Run: notch login");
}
