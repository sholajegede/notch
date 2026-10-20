"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/app", label: "Overview", match: (p: string) => p === "/app" },
  { href: "/app#links", label: "Links", match: (p: string) => p.startsWith("/app/links") },
  { href: "/app#proof", label: "Usage proof", match: () => false },
  { href: "/app#billing", label: "Billing", match: () => false },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav className="side-nav" aria-label="Dashboard">
      {items.map((item) => (
        <Link key={item.label} href={item.href} aria-current={item.match(pathname) ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
