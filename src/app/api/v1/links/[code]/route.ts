import { currentOwner } from "@/lib/auth";
import { convex, serverKey } from "@/lib/convex";
import { site } from "@/lib/site";
import { api } from "../../../../../../convex/_generated/api";

function cleanError(error: unknown): string {
  if (!(error instanceof Error)) return "Could not save the link.";
  const line = error.message.split("\n").find((l) => l.includes("Uncaught Error:")) ?? error.message;
  return line.replace(/^.*Uncaught Error: /, "").replace(/ at handler.*$/, "").trim() || "Could not save the link.";
}

/** Rename a link, change where it goes, or turn it off and on. */
export async function PATCH(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const owner = await currentOwner(request);
  if (!owner) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { code } = await params;
  const body = (await request.json().catch(() => ({}))) as { title?: unknown; url?: unknown; disabled?: unknown };
  const change: { title?: string; url?: string; disabled?: boolean } = {};
  if (typeof body.title === "string") change.title = body.title;
  if (typeof body.url === "string") {
    try {
      if (new URL(body.url).host === new URL(site.url).host) return Response.json({ error: "Use a link that is not on this site." }, { status: 400 });
    } catch {
      return Response.json({ error: "That is not a link." }, { status: 400 });
    }
    change.url = body.url;
  }
  if (typeof body.disabled === "boolean") change.disabled = body.disabled;
  try {
    const saved = await convex().mutation(api.ledger.updateLink, { serverKey: serverKey(), ownerId: owner.id, code, ...change });
    return Response.json(saved);
  } catch (error) {
    return Response.json({ error: cleanError(error) }, { status: 400 });
  }
}
