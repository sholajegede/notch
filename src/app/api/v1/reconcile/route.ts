import { currentOwner } from "@/lib/auth";
import { convex, serverKey } from "@/lib/convex";
import { api } from "../../../../../convex/_generated/api";

/** Prove the provider's total against the ledger, repair it if it is wrong, and return the evidence. */
export async function POST(request: Request) {
  const owner = await currentOwner(request);
  if (!owner) return Response.json({ error: "Sign in first." }, { status: 401 });
  const results = await convex().action(api.recon.reconcileNow, { serverKey: serverKey(), ownerId: owner.id });
  return Response.json({ results });
}
