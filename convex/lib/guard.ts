/**
 * The website talks to Convex with a shared server key, set as NOTCH_SERVER_KEY in both places.
 * Without the key, nobody outside the website can read or write the ledger.
 */
export function guard(key: string): void {
  const expected = process.env.NOTCH_SERVER_KEY;
  if (!expected || key !== expected) throw new Error("Not allowed.");
}
