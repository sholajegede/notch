import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

declare const NOTCH_DEFAULT_SERVER: string;

export interface Saved {
  server?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  /** For the Kinde device flow: where to refresh the token. */
  issuer?: string;
  client_id?: string;
}

const file = () =>
  process.env.NOTCH_CONFIG ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "notch", "credentials.json");

export function load(): Saved {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as Saved;
  } catch {
    return {};
  }
}

/** The sign-in is written with permissions for this user only. */
export function save(saved: Saved): void {
  const path = file();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(saved, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function forget(): boolean {
  const path = file();
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

export const configPath = file;

export function serverUrl(flag?: string): string {
  return (flag ?? process.env.NOTCH_URL ?? load().server ?? NOTCH_DEFAULT_SERVER).replace(/\/$/, "");
}
