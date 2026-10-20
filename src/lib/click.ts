import { looksLikeBot } from "../../convex/lib/core";

export interface ClickMeta {
  country?: string;
  region?: string;
  city?: string;
  device?: string;
  browser?: string;
  os?: string;
  referrer?: string;
}

/** Device, browser and system from the browser's name string. A rough guess, good enough for a chart. */
export function parseAgent(agent: string): { device: string; browser: string; os: string } {
  const device = looksLikeBot(agent, 0)
    ? "Bot"
    : /ipad|tablet/i.test(agent)
      ? "Tablet"
      : /mobi|iphone|android/i.test(agent)
        ? "Mobile"
        : "Desktop";
  const browser = /edg(e|a|ios)?\//i.test(agent)
    ? "Edge"
    : /opr\/|opera/i.test(agent)
      ? "Opera"
      : /samsungbrowser/i.test(agent)
        ? "Samsung Internet"
        : /firefox|fxios/i.test(agent)
          ? "Firefox"
          : /chrome|crios/i.test(agent)
            ? "Chrome"
            : /safari/i.test(agent)
              ? "Safari"
              : "Other";
  const os = /windows/i.test(agent)
    ? "Windows"
    : /iphone|ipad|ipod/i.test(agent)
      ? "iOS"
      : /android/i.test(agent)
        ? "Android"
        : /mac os x|macintosh/i.test(agent)
          ? "macOS"
          : /cros/i.test(agent)
            ? "ChromeOS"
            : /linux/i.test(agent)
              ? "Linux"
              : "Other";
  return { device, browser, os };
}

/** The place and the page the click came from. The platform sets these headers; no address is kept. */
export function clickMeta(headers: Headers, siteHost: string): ClickMeta {
  const agent = headers.get("user-agent") ?? "";
  const country = (headers.get("x-vercel-ip-country") ?? headers.get("cf-ipcountry") ?? "").toUpperCase();
  const region = headers.get("x-vercel-ip-country-region") ?? undefined;
  let city: string | undefined;
  const rawCity = headers.get("x-vercel-ip-city");
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity);
    } catch {
      city = rawCity;
    }
  }
  let referrer: string | undefined;
  const from = headers.get("referer");
  if (from) {
    try {
      const host = new URL(from).host.replace(/^www\./, "");
      if (host && host !== siteHost) referrer = host;
    } catch {
      // A broken referrer is treated as no referrer.
    }
  }
  return {
    country: /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1" ? country : undefined,
    region,
    city,
    referrer,
    ...parseAgent(agent),
  };
}
