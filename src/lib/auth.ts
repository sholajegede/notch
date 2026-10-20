import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { kindeReady, verifyAccessToken } from "./kinde";

export interface Owner {
  id: string;
  email: string | null;
}

/** The token the CLI uses against a local server that has no Kinde settings. */
export const LOCAL_TOKEN = "local-dev";
const LOCAL: Owner = { id: "local_dev", email: "you@example.com" };

/**
 * The signed-in person, or null.
 * A request with a Bearer token (the CLI) is checked against Kinde's keys.
 * Without Kinde settings, and only outside production, a local account is used so the app runs with no setup.
 */
export async function currentOwner(request?: Request): Promise<Owner | null> {
  const bearer = request?.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    if (!kindeReady()) return process.env.NODE_ENV !== "production" && bearer === LOCAL_TOKEN ? LOCAL : null;
    try {
      return { id: await verifyAccessToken(bearer), email: null };
    } catch {
      return null;
    }
  }
  if (!kindeReady()) return process.env.NODE_ENV === "production" ? null : LOCAL;
  const user = await getKindeServerSession().getUser();
  return user?.id ? { id: user.id, email: user.email ?? null } : null;
}

export const signInHref = () => "/api/auth/login?post_login_redirect_url=/app";
