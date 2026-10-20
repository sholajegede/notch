/** "10-20 22:53:09" in UTC. */
export const stamp = (ms: number): string => new Date(ms).toISOString().replace("T", " ").slice(5, 19);
export const n = (value: number): string => value.toLocaleString("en-US");
/** "2026-10-20" becomes "Oct 20". */
export const shortDay = (day: string): string => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
