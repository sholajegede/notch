import { currentOwner } from "@/lib/auth";
import { convex, serverKey } from "@/lib/convex";
import { api } from "../../../../../convex/_generated/api";

export async function GET(request: Request) {
  const owner = await currentOwner(request);
  if (!owner) return Response.json({ error: "Sign in first." }, { status: 401 });
  const view = await convex().query(api.ledger.overview, { serverKey: serverKey(), ownerId: owner.id });
  return Response.json({ id: owner.id, email: owner.email, cycle: view.cycle, clicks: view.total, connected: view.billing !== null });
}
