import { issuer, kindeReady } from "@/lib/kinde";
import { LOCAL_TOKEN } from "@/lib/auth";

/**
 * What the CLI needs to sign in. With Kinde set up, the CLI uses the device flow of the
 * "Device and IoT" application. Without Kinde, a local server gives the CLI a local token.
 */
export function GET() {
  if (kindeReady() && process.env.KINDE_DEVICE_CLIENT_ID) {
    return Response.json({ mode: "kinde", issuer: issuer(), client_id: process.env.KINDE_DEVICE_CLIENT_ID });
  }
  if (!kindeReady() && process.env.NODE_ENV !== "production") {
    return Response.json({ mode: "local", token: LOCAL_TOKEN });
  }
  return Response.json({ error: "This server does not accept CLI sign-in yet." }, { status: 503 });
}
