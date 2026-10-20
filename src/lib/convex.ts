import { ConvexHttpClient } from "convex/browser";

/** The server key lets this website, and nothing else, read and write the ledger. */
export const serverKey = (): string => {
  const key = process.env.NOTCH_SERVER_KEY;
  if (!key) throw new Error("NOTCH_SERVER_KEY is not set. Run: npm run setup");
  return key;
};

export const convex = (): ConvexHttpClient => {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set. Run: npm run setup");
  return new ConvexHttpClient(url);
};

/** The meter is the built-in stand-in unless Kinde is chosen. Only the stand-in can be broken on purpose. */
export const simulated = (): boolean => process.env.METER_DRIVER !== "kinde";
