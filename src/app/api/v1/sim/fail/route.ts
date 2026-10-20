import { currentOwner } from "@/lib/auth";
import { convex, serverKey, simulated } from "@/lib/convex";
import { api } from "../../../../../../convex/_generated/api";

/** Make the next reports to the stand-in meter fail, as an outage would. Not available with Kinde. */
export async function POST(request: Request) {
  const owner = await currentOwner(request);
  if (!owner) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!simulated()) return Response.json({ error: "This is only for the built-in meter." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { count?: unknown };
  const count = typeof body.count === "number" && Number.isFinite(body.count) ? Math.min(Math.max(Math.trunc(body.count), 1), 6) : 2;
  await convex().mutation(api.sim.failNext, { serverKey: serverKey(), ownerId: owner.id, count });
  return Response.json({ failing: count });
}
