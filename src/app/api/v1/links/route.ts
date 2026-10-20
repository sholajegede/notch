import { currentOwner } from "@/lib/auth";
import { convex, serverKey } from "@/lib/convex";
import { site } from "@/lib/site";
import { api } from "../../../../../convex/_generated/api";

/** Convex wraps a thrown message in extra lines. Keep only the message. */
function cleanError(error: unknown): string {
  if (!(error instanceof Error)) return "Could not make the link.";
  const line = error.message.split("\n").find((l) => l.includes("Uncaught Error:")) ?? error.message;
  return line.replace(/^.*Uncaught Error: /, "").replace(/ at handler.*$/, "").trim() || "Could not make the link.";
}

export async function POST(request: Request) {
  const owner = await currentOwner(request);
  if (!owner) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== "string") return Response.json({ error: "Send the link as url." }, { status: 400 });
  try {
    // A short link that points back at Notch would loop.
    if (new URL(body.url).host === new URL(site.url).host) return Response.json({ error: "Use a link that is not on this site." }, { status: 400 });
  } catch {
    return Response.json({ error: "That is not a link." }, { status: 400 });
  }
  try {
    const link = await convex().mutation(api.ledger.createLink, { serverKey: serverKey(), ownerId: owner.id, url: body.url });
    return Response.json({ code: link.code, url: link.url, short_url: `${site.url}/s/${link.code}`, qr_url: `${site.url}/qr/${link.code}` }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? cleanError(error) : "Could not make the link.";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const owner = await currentOwner(request);
  if (!owner) return Response.json({ error: "Sign in first." }, { status: 401 });
  const view = await convex().query(api.ledger.overview, { serverKey: serverKey(), ownerId: owner.id });
  return Response.json({ links: view.links.map((l) => ({ ...l, short_url: `${site.url}/s/${l.code}` })) });
}
