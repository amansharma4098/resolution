import Link from "next/link";
import { Button } from "@/components/ui/button";

const steps = [
  {
    n: 1,
    title: "Connect your systems",
    body: "Wire up Jira, ServiceNow, Fabric, Datadog and more from the UI — nothing is hard-coded to one vendor.",
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
    </main>
  );
}
