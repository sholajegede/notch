import { currentOwner } from "@/lib/auth";
import { convex, serverKey } from "@/lib/convex";
import { api } from "../../../../../../convex/_generated/api";

/** Clicks recorded somewhere else and sent late. The key of each click stops a second run from counting it twice. */
export async function POST(request: Request) {
  const owner = await currentOwner(request);
  if (!owner) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { clicks?: unknown };
  const clicks = Array.isArray(body.clicks) ? body.clicks : null;
  const valid = clicks?.every((c) => c && typeof c.key === "string" && typeof c.code === "string" && typeof c.at === "number");
  if (!clicks || !valid) return Response.json({ error: "Send clicks as a list of { key, code, at }, with at in milliseconds." }, { status: 400 });
  try {
    return Response.json(await convex().mutation(api.ledger.backfill, { serverKey: serverKey(), ownerId: owner.id, clicks }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.split("\n")[0] : "The backfill failed." }, { status: 400 });
  }
}
