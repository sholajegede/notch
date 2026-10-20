import { createHash, randomUUID } from "node:crypto";
import { after } from "next/server";
import { convex, serverKey } from "@/lib/convex";
import { api } from "../../../../convex/_generated/api";

/**
 * The short link. Send the person on first, then write the click to the ledger after the response.
 * The click key is made here, before anything is written, so every try to write the click carries the same key and it counts once.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Za-z0-9]{4,16}$/.test(code)) return new Response("Not found", { status: 404 });
  const client = convex();
  const link = await client.query(api.ledger.getLink, { serverKey: serverKey(), code });
  if (!link) return new Response("This link does not exist.", { status: 404 });

  const at = Date.now();
  const key = request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id") ?? randomUUID();
  const agent = request.headers.get("user-agent") ?? "";
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  // Only a hash of the address is kept, with a salt, so a click can be grouped but not traced.
  const ipHash = createHash("sha256").update(`${serverKey()}:${address}`).digest("hex").slice(0, 16);
  after(async () => {
    // The key was made here, so trying again is safe: the ledger counts a key once.
    // Many clicks at once can collide on a counter row. Wait a random, growing time so the retries do not collide again.
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await client.mutation(api.ledger.recordClick, { serverKey: serverKey(), code, key, at, agent, ipHash });
        return;
      } catch (error) {
        if (attempt === 5) console.error("Notch could not record a click", key, error);
        else await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt + Math.random() * 300));
      }
    }
  });
  return new Response(null, { status: 307, headers: { location: link.url, "cache-control": "no-store" } });
}
