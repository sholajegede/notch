import { currentOwner } from "@/lib/auth";
import { convex, serverKey } from "@/lib/convex";
import { api } from "../../../../../convex/_generated/api";

function cleanError(error: unknown): string {
  if (!(error instanceof Error)) return "Could not save the billing settings.";
  const line = error.message.split("\n").find((l) => l.includes("Uncaught Error:")) ?? error.message;
  return line.replace(/^.*Uncaught Error: /, "").replace(/ at handler.*$/, "").trim() || "Could not save the billing settings.";
}

/**
 * Tell Notch which Kinde billing agreement and feature this account's clicks are reported to.
 * cycle_start is the moment the agreement started (an ISO date and time). Kinde starts each billing cycle on that day and time.
 */
export async function POST(request: Request) {
  const owner = await currentOwner(request);
  if (!owner) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { agreement_id?: unknown; feature_code?: unknown; cycle_start?: unknown };
  if (typeof body.agreement_id !== "string" || !body.agreement_id.trim()) {
    return Response.json({ error: "Send the Kinde agreement id as agreement_id." }, { status: 400 });
  }
  const featureCode = typeof body.feature_code === "string" && body.feature_code.trim() ? body.feature_code.trim() : "clicks";
  let cycleStart: number | undefined;
  if (typeof body.cycle_start === "string" && body.cycle_start.trim()) {
    cycleStart = Date.parse(body.cycle_start.trim());
    if (Number.isNaN(cycleStart)) return Response.json({ error: "Send the agreement start as a date and time, for example 2026-10-20T15:29:00Z." }, { status: 400 });
  }
  try {
    await convex().mutation(api.ledger.connect, { serverKey: serverKey(), ownerId: owner.id, agreementId: body.agreement_id.trim(), featureCode, cycleStart });
  } catch (error) {
    return Response.json({ error: cleanError(error) }, { status: 400 });
  }
  return Response.json({ connected: true, feature_code: featureCode });
}
