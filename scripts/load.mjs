// Sends many clicks to one short link, from many pretend visitors, and reports how the server held up.
// Usage: node scripts/load.mjs <short code> [--url http://localhost:3000] [--clicks 5000] [--concurrency 100]
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { url: { type: "string", default: "http://localhost:3000" }, clicks: { type: "string", default: "5000" }, concurrency: { type: "string", default: "100" } },
});
const code = positionals[0];
if (!code) {
  console.error("Give the short code, for example: node scripts/load.mjs k3Fm9Qz");
  process.exit(2);
}
const total = Number(values.clicks);
const workers = Number(values.concurrency);
const target = `${values.url.replace(/\/$/, "")}/s/${code}`;
// A mix of visitors, so the dashboard has places, devices and referrers to chart.
// The place headers are the ones Vercel sets. Notch reads them on a host that sets them, and this script sets them on your own machine.
const agents = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
];
const places = [
  ["NG", "LA", "Lagos"], ["NG", "FC", "Abuja"], ["GB", "ENG", "London"], ["US", "CA", "San Francisco"], ["US", "NY", "New York"],
  ["DE", "BE", "Berlin"], ["IN", "KA", "Bengaluru"], ["KE", "30", "Nairobi"], ["CA", "ON", "Toronto"], ["FR", "IDF", "Paris"],
];
const referrers = ["https://x.com/", "https://www.linkedin.com/", "https://news.ycombinator.com/", "https://dev.to/", "", "", ""];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

let sent = 0;
let next = 0;
const statuses = new Map();
const latencies = [];
const started = Date.now();

async function worker() {
  while (next < total) {
    next += 1;
    // A different visitor address and request id each time, so none of these look like one bot or one retry.
    const [country, region, city] = pick(places);
    const headers = {
      "user-agent": pick(agents),
      "x-forwarded-for": `10.${(next >> 16) & 255}.${(next >> 8) & 255}.${next & 255}`,
      "x-request-id": randomUUID(),
      "x-vercel-ip-country": country,
      "x-vercel-ip-country-region": region,
      "x-vercel-ip-city": encodeURIComponent(city),
    };
    const from = pick(referrers);
    if (from) headers.referer = from;
    const begin = performance.now();
    try {
      const response = await fetch(target, { redirect: "manual", headers });
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
    } catch {
      statuses.set("error", (statuses.get("error") ?? 0) + 1);
    }
    latencies.push(performance.now() - begin);
    sent += 1;
  }
}

await Promise.all(Array.from({ length: workers }, worker));
const seconds = (Date.now() - started) / 1000;
latencies.sort((a, b) => a - b);
const at = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))].toFixed(0);
console.log(`${sent} requests in ${seconds.toFixed(1)}s, ${(sent / seconds).toFixed(0)} a second, ${workers} at a time`);
console.log(`answers: ${[...statuses].map(([k, v]) => `${k} x${v}`).join(", ")}`);
console.log(`redirect time: median ${at(0.5)} ms, 95th ${at(0.95)} ms, 99th ${at(0.99)} ms`);
console.log(`\nThe clicks are written after each redirect. Wait a few seconds, then check that the ledger holds ${statuses.get(307) ?? 0} more clicks:`);
console.log("  npm run notch -- links    (the count on this link)");
console.log("  npm run notch -- reconcile");
