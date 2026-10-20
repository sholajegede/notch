import { Logo } from "@/components/chrome";
import { SideNav } from "@/components/side-nav";
import { site } from "@/lib/site";

/** The frame around every dashboard page: a side bar on a wide screen, a top bar on a narrow one. */
export function Shell({ email, canLogOut, children }: { email: string | null; canLogOut: boolean; children: React.ReactNode }) {
  return (
    <div className="app">
      <aside className="side">
        <Logo />
        <SideNav />
        <div className="side-foot">
          {email && <span className="who">{email}</span>}
          {/* A plain link on purpose: a Link would prefetch the log-out route and sign you out. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          {canLogOut && <a href="/api/auth/logout">Log out</a>}
          <a href={site.repo}>GitHub</a>
        </div>
      </aside>
      <div className="app-main">{children}</div>
    </div>
  );
}
