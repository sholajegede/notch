import { currentOwner } from "@/lib/auth";
import { convex, serverKey, simulated } from "@/lib/convex";
import { api } from "../../../../../../convex/_generated/api";

/** Move the stand-in meter without a report, as a counted-twice report would. Not available with Kinde. */
export async function POST(request: Request) {
  const owner = await currentOwner(request);
  if (!owner) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!simulated()) return Response.json({ error: "This is only for the built-in meter." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { amount?: unknown };
  const amount = typeof body.amount === "number" && Number.isFinite(body.amount) ? Math.trunc(body.amount) : 6;
  await convex().mutation(api.sim.drift, { serverKey: serverKey(), ownerId: owner.id, amount });
  return Response.json({ drifted: amount });
}
