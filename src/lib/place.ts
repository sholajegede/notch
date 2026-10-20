export interface Place {
  country?: string;
  region?: string;
  city?: string;
}

/** True for an address that points at this machine or a private network. It has no place of its own. */
export function isPrivateAddress(address: string): boolean {
  const a = address.trim().toLowerCase();
  if (!a || a === "local" || a === "::1" || a === "localhost") return true;
  if (a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80")) return true;
  const m = a.replace(/^::ffff:/, "").match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 10 || x === 127 || x === 0 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254);
}

const cache = new Map<string, { place: Place; at: number }>();
const HOUR = 3_600_000;

/**
 * Find the country, region and city for an address when the host did not send them (for example on localhost).
 * Only the place is returned and kept. The address is sent to the lookup service and nowhere else.
 * A private or local address looks up the machine's own public address, which is where a developer is clicking from.
 */
export async function lookupPlace(address: string, fetcher: typeof fetch = fetch): Promise<Place> {
  const own = isPrivateAddress(address);
  const key = own ? "own" : address;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit.place;
  try {
    const response = await fetcher(`https://ipwho.is/${own ? "" : encodeURIComponent(address)}?fields=success,country_code,region,city`, {
      signal: AbortSignal.timeout(2000),
    });
    const body = (await response.json()) as { success?: boolean; country_code?: string; region?: string; city?: string };
    if (!body.success) return {};
    const place: Place = {
      country: /^[A-Z]{2}$/.test(body.country_code ?? "") ? body.country_code : undefined,
      region: body.region || undefined,
      city: body.city || undefined,
    };
    if (cache.size > 500) cache.clear();
    cache.set(key, { place, at: Date.now() });
    return place;
  } catch {
    return {};
  }
}
