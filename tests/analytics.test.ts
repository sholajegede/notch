import { describe, expect, it } from "vitest";
import { summarise } from "../convex/lib/analytics";
import { clickMeta, parseAgent } from "../src/lib/click";
import { countryName, flag } from "../src/lib/geo";

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 20, 12);

describe("summarise", () => {
  it("fills every day, even days with no clicks, oldest first", () => {
    const s = summarise([{ at: now }, { at: now - 2 * DAY }, { at: now - 2 * DAY }], now, { days: 5 });
    expect(s.days.map((d) => d.day)).toEqual(["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]);
    expect(s.days.map((d) => d.count)).toEqual([0, 0, 2, 0, 1]);
  });

  it("counts by place, orders by size, and names what is missing", () => {
    const s = summarise([{ at: now, country: "NG" }, { at: now, country: "NG" }, { at: now, country: "GB" }, { at: now }], now);
    expect(s.countries).toEqual([
      { name: "NG", count: 2 },
      { name: "GB", count: 1 },
      { name: "Unknown", count: 1 },
    ]);
    expect(s.referrers).toEqual([{ name: "Direct", count: 4 }]);
  });

  it("keeps only the top few and reports the oldest click", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ at: now - i, country: `C${i}` }));
    const s = summarise(rows, now, { top: 3 });
    expect(s.countries).toHaveLength(3);
    expect(s.since).toBe(now - 11);
    expect(s.sample).toBe(12);
  });

  it("is empty and safe with no clicks", () => {
    const s = summarise([], now);
    expect(s).toMatchObject({ sample: 0, since: null, countries: [] });
    expect(s.days).toHaveLength(14);
  });
});

describe("parseAgent", () => {
  it("reads common browsers", () => {
    expect(parseAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toEqual({ device: "Mobile", browser: "Safari", os: "iOS" });
    expect(parseAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0")).toEqual({ device: "Desktop", browser: "Edge", os: "Windows" });
    expect(parseAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36")).toEqual({ device: "Mobile", browser: "Chrome", os: "Android" });
    expect(parseAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Gecko/20100101 Firefox/121.0")).toEqual({ device: "Desktop", browser: "Firefox", os: "macOS" });
  });

  it("calls a robot a bot", () => {
    expect(parseAgent("curl/8.4.0").device).toBe("Bot");
    expect(parseAgent("Googlebot/2.1").device).toBe("Bot");
  });
});

describe("clickMeta", () => {
  it("reads the place from the platform headers and drops this site as a referrer", () => {
    const h = new Headers({
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      "x-vercel-ip-country": "ng",
      "x-vercel-ip-country-region": "LA",
      "x-vercel-ip-city": "Ikeja%20GRA",
      referer: "https://www.x.com/post/1",
    });
    expect(clickMeta(h, "notch.test")).toMatchObject({ country: "NG", region: "LA", city: "Ikeja GRA", referrer: "x.com", browser: "Safari", os: "macOS" });
    expect(clickMeta(new Headers({ referer: "https://notch.test/app" }), "notch.test").referrer).toBeUndefined();
  });

  it("leaves the place empty when the headers are missing or not a country", () => {
    expect(clickMeta(new Headers(), "notch.test").country).toBeUndefined();
    expect(clickMeta(new Headers({ "x-vercel-ip-country": "XX" }), "notch.test").country).toBeUndefined();
  });
});

describe("geo", () => {
  it("names a country and draws its flag", () => {
    expect(countryName("NG")).toBe("Nigeria");
    expect(flag("NG")).toBe("🇳🇬");
    expect(countryName("Unknown")).toBe("Unknown");
    expect(flag("Unknown")).toBe("");
  });
});
