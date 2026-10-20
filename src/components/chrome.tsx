import Link from "next/link";
import { site } from "@/lib/site";

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="Notch home">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M4 4h24v24H4z M20 4v8h8" fill="none" stroke="#000" strokeWidth="3.4" strokeLinejoin="round" />
      </svg>
      notch
    </Link>
  );
}

export function Banner() {
  return (
    <div className="banner">
      Prove your usage bill in one command: <code>notch reconcile</code>
    </div>
  );
}

export function Nav({ signedIn = false, href }: { signedIn?: boolean; href: string }) {
  return (
    <nav className="nav wrap" aria-label="Main">
      <Logo />
      <div className="nav-links">
        <Link href="/#problem">The problem</Link>
        <Link href="/#how">How it works</Link>
        <Link href="/#try">Try it</Link>
        <Link href="/#cli">CLI</Link>
        <a href={site.repo}>GitHub</a>
        <a className="btn" href={href}>
          {signedIn ? "Dashboard" : "Log in"}
        </a>
      </div>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <span>{site.name}. {site.tagline}</span>
        <span>
          Open source on <a href={site.repo}>GitHub</a>. Billing by Kinde.
        </span>
      </div>
    </footer>
  );
}
