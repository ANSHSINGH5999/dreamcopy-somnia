"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const NAV_LINKS = [
  { href: "/", label: "Overview" },
  { href: "/traders", label: "Traders" },
  { href: "/follow", label: "Follow" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/referral", label: "Referrals" },
  { href: "/analytics", label: "Analytics" },
  { href: "/simulate", label: "Simulate" },
  { href: "/strategies", label: "Strategies" },
  { href: "/settings", label: "Settings" },
];

// A black header against the cream body is the app's one deliberate
// high-contrast moment — bookends the page (paired with the dark footer)
// and gives violet's accent color something dark to pop against, instead
// of competing with it as another "primary" hue on every button.
export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 bg-black">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-2xl font-bold leading-none text-violet-400">
            DreamCopy
          </Link>
          <nav className="hidden gap-6 text-sm md:flex">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={
                    active
                      ? "font-semibold text-violet-400"
                      : "text-stone-400 transition hover:text-white"
                  }
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <ConnectButton showBalance={false} />
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-stone-700 text-stone-300 transition hover:border-violet-400 hover:text-violet-400 md:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile slide-out drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-72 max-w-[85vw] border-l border-stone-800 bg-black p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-xl font-bold text-violet-400">Menu</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-stone-700 text-stone-300 transition hover:border-violet-400 hover:text-violet-400"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <nav className="mt-8 flex flex-col gap-1 text-base">
              {NAV_LINKS.map((link) => {
                const active = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className={
                      active
                        ? "rounded-lg bg-violet-950 px-3 py-3 font-semibold text-violet-400"
                        : "rounded-lg px-3 py-3 text-stone-300 transition hover:bg-stone-900 hover:text-white"
                    }
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-8 sm:hidden">
              <ConnectButton showBalance={false} />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
