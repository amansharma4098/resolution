import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

const points = [
  "Connects to the ITSM, monitoring, cloud, data and infrastructure systems you already run.",
  "Every root cause cites its evidence. Every remediation is policy-gated and verified.",
  "You decide how much autonomy it gets — from observe-only to fully autonomous.",
];

/**
 * Shared split-screen shell for /login and /signup. Left brand panel reuses the dark-hero
 * treatment from the landing page (app/page.tsx) — navy-dark background, blurred navy
 * circles, kicker + display headline — so auth doesn't feel like a different product.
 * Collapses to just the form (with a small wordmark above it) below md.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen bg-background">
      <div className="relative hidden w-1/2 max-w-xl shrink-0 overflow-hidden bg-navy-dark px-12 py-16 text-white md:flex md:flex-col md:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-navy opacity-60 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-56 -left-32 h-[28rem] w-[28rem] rounded-full bg-navy opacity-40 blur-3xl"
        />
        <Logo dark className="relative" />
        <div className="relative flex flex-col gap-6">
          <div>
            <span className="kicker">AI Incident Resolution Platform</span>
            <h1 className="mt-2 max-w-sm font-display text-2xl font-semibold leading-tight sm:text-3xl">
              An AI agent that investigates, diagnoses and resolves your production incidents.
            </h1>
          </div>
          <ul className="flex flex-col gap-3 text-sm text-ice">
            {points.map((point) => (
              <li key={point} className="flex gap-2">
                <span aria-hidden>—</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-ice/70">© {new Date().getFullYear()} FixCaptain</p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
        <Logo className="md:hidden" />
        {children}
      </div>
    </main>
  );
}
