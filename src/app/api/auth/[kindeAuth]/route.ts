import type { NextRequest } from "next/server";
import { kindeReady } from "@/lib/kinde";

/** Kinde sign-in, sign-out and callback. Loaded only when the Kinde settings are present. */
export async function GET(request: NextRequest, context: { params: Promise<{ kindeAuth: string }> }) {
  if (!kindeReady()) {
    return Response.json({ error: "Sign-in is not set up on this server." }, { status: 404 });
  }
  const { handleAuth } = await import("@kinde-oss/kinde-auth-nextjs/server");
  return handleAuth()(request, context);
}
