import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
// Mirrors packages/billing/src/packs.ts — a marketing page reads real numbers, but as a
// static copy rather than a live import (this renders unauthenticated, pre-signup). Keep
// these in sync by hand if pricing changes there.
const CREDIT_PACKS = [
  { name: "Starter", credits: "5,000", price: "$80", baseline: "$100" },
  { name: "Growth", credits: "20,000", price: "$320", baseline: "$400" },
  { name: "Scale", credits: "100,000", price: "$1,600", baseline: "$2,000" },
];

const steps = [
  {
    n: 1,
    title: "Connect your systems",
    body: "Wire up Jira, ServiceNow, Fabric, Datadog and more from the UI — or point it at your own MCP server. Nothing is hard-coded to one vendor.",
  },
  {
    n: 2,
    title: "The agent investigates",
    body: "It discovers the affected system, gathers real evidence through typed Map Server capabilities, and searches your own incident history.",
  },
  {
    n: 3,
    title: "You stay in control",
    body: "Every RCA cites its evidence. Every remediation is policy-gated and verified against real system state before an incident is marked resolved.",
  },
];

const capabilities = [
  {
    title: "Real observability, not just tickets",
    body: "A Datadog monitor firing creates an incident automatically — no one has to open a ticket first. The agent investigates with real metrics and logs, then resolves it if your policy allows.",
  },
  {
    title: "Ask it, in plain English",
    body: "The built-in chat assistant lists incidents grouped by platform, investigates, and resolves one on command — it picks whichever connected system can actually perform the fix.",
  },
];

export default function LandingPage() {
  return (
    <main>
      {/* Dark hero — sandwich structure per BUILD spec §13 */}
      <section className="relative overflow-hidden bg-navy-dark text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-navy opacity-60 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-56 -left-32 h-[28rem] w-[28rem] rounded-full bg-navy opacity-40 blur-3xl"
        />
        <div className="relative mx-auto flex max-w-5xl flex-col items-start gap-6 px-6 py-24 sm:py-32">
          <span className="kicker">AI Incident Resolution Platform</span>
          <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">
            An AI agent that investigates, diagnoses, remediates and verifies your production
            incidents.
          </h1>
          <p className="max-w-2xl text-lg text-ice">
            Connects to the ITSM, monitoring, cloud, data and infrastructure systems you
            already run. You decide how much autonomy it gets — from observe-only to fully
            autonomous.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/signup">
              <Button size="lg">Get started</Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="secondary" className="border-white/20 bg-transparent text-white hover:bg-white/10">
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Light app-style section — steps, using the numbered-circle motif */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <span className="kicker">How it works</span>
        <h2 className="mt-2 max-w-2xl font-display text-2xl font-semibold text-ink sm:text-3xl">
          From alert to verified resolution
        </h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {steps.map((step) => (
            <div key={step.n} className="flex flex-col gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ice font-display text-lg font-semibold text-navy">
                {step.n}
              </div>
              <h3 className="font-display text-lg font-semibold text-ink">{step.title}</h3>
              <p className="text-sm text-subink">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Dark section again — sandwich structure — the two newest, most tangible
          capabilities get their own beat rather than being buried in the numbered steps. */}
      <section className="relative overflow-hidden bg-navy-dark px-6 py-20 text-white">
        <div className="relative mx-auto max-w-5xl">
          <span className="kicker">What&apos;s new</span>
          <h2 className="mt-2 max-w-2xl font-display text-2xl font-semibold sm:text-3xl">
            An observability platform with an agent that actually resolves things
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            {capabilities.map((c) => (
              <div key={c.title} className="rounded border border-white/10 bg-white/5 p-6">
                <h3 className="font-display text-lg font-semibold">{c.title}</h3>
                <p className="mt-2 text-sm text-ice">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Light section — pricing. Numbers mirror packages/billing/src/packs.ts. */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <span className="kicker">Pricing</span>
        <h2 className="mt-2 max-w-2xl font-display text-2xl font-semibold text-ink sm:text-3xl">
          Pay for what the agent actually does
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-subink">
          One credit = one cent of real cost — LLM tokens and remediation execution. Buy a
          pack once and it&apos;s 20% cheaper per credit than metered pay-as-you-go.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {CREDIT_PACKS.map((pack) => (
            <Card key={pack.name}>
              <CardContent className="flex flex-col gap-3 py-6">
                <div>
                  <p className="font-display text-lg font-semibold text-ink">{pack.name}</p>
                  <p className="text-sm text-subink">{pack.credits} credits</p>
                </div>
                <div>
                  <span className="font-display text-3xl font-semibold text-ink">{pack.price}</span>{" "}
                  <span className="text-sm text-subink line-through">{pack.baseline}</span>
                  <p className="text-xs text-success">20% off pay-as-you-go</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-8">
          <Link href="/signup">
            <Button size="lg">Get started</Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
