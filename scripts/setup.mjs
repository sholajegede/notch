// Makes a server key and stores it in .env.local and on your Convex deployment. The key is never printed.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const file = ".env.local";
const text = existsSync(file) ? readFileSync(file, "utf8") : "";
const existing = text.match(/^NOTCH_SERVER_KEY=(.+)$/m)?.[1];
const key = existing ?? randomBytes(32).toString("hex");
if (!existing) writeFileSync(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}NOTCH_SERVER_KEY=${key}\n`);

const result = spawnSync("npx", ["convex", "env", "set", "NOTCH_SERVER_KEY", key], { stdio: ["inherit", "ignore", "inherit"] });
if (result.status !== 0) {
  console.error("Could not set the key on Convex. Run `npx convex dev` once, then run `npm run setup` again.");
  process.exit(1);
}
console.log(existing ? "The server key was already in .env.local. It is now set on Convex too." : "Made a server key. It is in .env.local and on your Convex deployment.");
