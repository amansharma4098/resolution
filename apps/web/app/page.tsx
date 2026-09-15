import Link from "next/link";
import { Button } from "@/components/ui/button";

// Deliberately just the intro — a single dark hero (sandwich structure per BUILD spec §13,
// here with no light section below it since there's nothing else on this page). The full
// pitch (how it works, pricing, newer capabilities) now lives behind Get started/Sign in,
// not on the page someone sees before deciding whether to click either.
export default function LandingPage() {
  return (
    <main className="relative flex min-h-screen items-center overflow-hidden bg-navy-dark text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-navy opacity-60 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-56 -left-32 h-[28rem] w-[28rem] rounded-full bg-navy opacity-40 blur-3xl"
      />
      <div className="relative mx-auto flex max-w-3xl flex-col items-start gap-6 px-6 py-24">
        <span className="kicker">Observability, with an AI agent that fixes what it finds</span>
        <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
          Connect your monitoring. When something breaks, the agent investigates, proposes a
          fix, and — if you let it — applies it.
        </h1>
        <p className="max-w-xl text-lg text-ice">
          Datadog and more feed incidents in automatically. The agent finds the root cause,
          not just the alert. You choose how far it goes — from just watching, to asking
          before it acts, to fixing things on its own.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/signup">
            <Button size="lg">Get started</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="secondary" className="border-white/20 bg-transparent text-white hover:bg-white/10">
              Login
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
