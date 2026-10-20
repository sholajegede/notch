import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
await build({
  absWorkingDir: dirname(fileURLToPath(import.meta.url)),
  entryPoints: ["src/index.ts"],
  outfile: "dist/notch.mjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  define: {
    NOTCH_VERSION: JSON.stringify(version),
    // The published CLI talks to the public server unless NOTCH_URL or --server says otherwise.
    NOTCH_DEFAULT_SERVER: JSON.stringify(process.env.NOTCH_DEFAULT_SERVER ?? "http://localhost:3000"),
  },
});
console.log(`built dist/notch.mjs (${version})`);
