import { redirect } from "next/navigation";
import { Nav } from "@/components/chrome";
import { Shell } from "@/components/shell";
import { currentOwner, signInHref } from "@/lib/auth";
import { kindeReady } from "@/lib/kinde";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const owner = await currentOwner();
  if (!owner) {
    if (kindeReady()) redirect(signInHref());
    return (
      <>
        <Nav href="/" />
        <main className="wrap dash">
          <h1>Sign-in is not set up</h1>
          <p className="sub">This server has no Kinde settings. Add them, then open this page again.</p>
        </main>
      </>
    );
  }
  return (
    <Shell email={owner.email} canLogOut={kindeReady()}>
      {children}
    </Shell>
  );
}
