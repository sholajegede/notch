import { currentOwner } from "@/lib/auth";
import { convex, serverKey } from "@/lib/convex";
import { api } from "../../../../../convex/_generated/api";

/** Tell Notch which Kinde billing agreement and feature this account's clicks are reported to. */
export async function POST(request: Request) {
  const owner = await currentOwner(request);
  if (!owner) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { agreement_id?: unknown; feature_code?: unknown };
  if (typeof body.agreement_id !== "string" || !body.agreement_id.trim()) {
    return Response.json({ error: "Send the Kinde agreement id as agreement_id." }, { status: 400 });
  }
  const featureCode = typeof body.feature_code === "string" && body.feature_code.trim() ? body.feature_code.trim() : "clicks";
  await convex().mutation(api.ledger.connect, { serverKey: serverKey(), ownerId: owner.id, agreementId: body.agreement_id.trim(), featureCode });
  return Response.json({ connected: true, feature_code: featureCode });
}
