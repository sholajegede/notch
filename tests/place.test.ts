import { describe, expect, it } from "vitest";
import { isPrivateAddress, lookupPlace } from "../src/lib/place";

const answer = (body: unknown) => (async () => ({ json: async () => body })) as unknown as typeof fetch;

describe("isPrivateAddress", () => {
  it("knows local and private addresses", () => {
    for (const a of ["local", "::1", "127.0.0.1", "10.1.2.3", "192.168.1.9", "172.20.0.1", "::ffff:127.0.0.1", "fd00::1"]) expect(isPrivateAddress(a)).toBe(true);
    for (const a of ["8.8.8.8", "172.32.0.1", "105.112.1.1"]) expect(isPrivateAddress(a)).toBe(false);
  });
});

describe("lookupPlace", () => {
  it("returns the country, region and city and nothing else", async () => {
    const place = await lookupPlace("105.112.1.1", answer({ success: true, country_code: "NG", region: "Lagos", city: "Ikeja", ip: "105.112.1.1" }));
    expect(place).toEqual({ country: "NG", region: "Lagos", city: "Ikeja" });
  });

  it("returns an empty place when the service fails or says no", async () => {
    expect(await lookupPlace("1.2.3.4", answer({ success: false }))).toEqual({});
    const broken = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await lookupPlace("5.6.7.8", broken)).toEqual({});
  });
});
