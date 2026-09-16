import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

const outcomes = [
  {
    title: "Start with evidence, not a guess",
    body: "The agent queries only the monitoring, ITSM and operational tools your team has connected. Its root-cause analysis cites the evidence it used and separates facts from hypotheses.",
  },
  {
    title: "Keep humans in control",
    body: "Every possible change is matched to a policy you set. Begin in observe-only mode, require approval for each action, or explicitly allow a low-risk action to run on its own.",
  },
  {
    title: "Close the loop for real",
    body: "A successful API response is not treated as a resolved incident. Resolution verifies the expected state in the connected system before it closes the loop.",
  },
];

const workflow = [
  [
    "01",
    "Receive",
    "A Datadog alert, Jira issue, ServiceNow ticket, or webhook opens an incident.",
  ],
  [
    "02",
    "Investigate",
    "The agent gathers permitted telemetry and records each useful result as evidence.",
  ],
  ["03", "Decide", "It produces a cited RCA and proposes at most one appropriate remediation."],
  [
    "04",
    "Verify",
    "Policy or a human authorizes the action, then Resolution checks the live outcome.",
  ],
] as const;

function ArrowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 text-sm font-medium text-info hover:underline"
    >
      {children} <span aria-hidden>→</span>
    </Link>
  );
}

/**
 * The public page deliberately sells the capabilities that are live today instead of
 * inventing customer logos, resolution-rate claims, or broad "autonomous" promises.
 * The useful buying distinction is that Resolution combines AI investigation with
 * deterministic permissioning and verification, rather than being another alert summary.
 */
export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-ink">
      <section className="relative overflow-hidden bg-navy-dark text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-navy opacity-70 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-56 -left-32 h-[28rem] w-[28rem] rounded-full bg-navy opacity-50 blur-3xl"
        />

        <header className="relative mx-auto flex h-20 max-w-6xl items-center justify-between px-6">
          <Logo dark />
          <nav
            className="hidden items-center gap-6 text-sm text-ice md:flex"
            aria-label="Main navigation"
          >
            <Link href="#workflow" className="hover:text-white">
              How it works
            </Link>
            <Link href="#controls" className="hover:text-white">
              Safety controls
            </Link>
            <Link href="/login" className="hover:text-white">
              Sign in
            </Link>
          </nav>
          <Link href="/signup" className="md:hidden">
            <Button
              size="sm"
              variant="secondary"
              className="border-white/20 bg-transparent text-white hover:bg-white/10"
            >
              Create workspace
            </Button>
          </Link>
        </header>

        <div className="relative mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-28 lg:pt-16">
          <div className="max-w-2xl">
            <span className="kicker">AI incident resolution, with guardrails</span>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.05] sm:text-5xl lg:text-6xl">
              Turn production alerts into verified recovery.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-ice">
              Resolution investigates incidents against your real operational systems, explains what
              happened with cited evidence, and proposes a safe next action. You decide when the
              system can act—and it proves the result before it calls an incident resolved.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup">
                <Button size="lg">Create your workspace</Button>
              </Link>
              <Link href="#workflow">
                <Button
                  size="lg"
                  variant="secondary"
                  className="border-white/20 bg-transparent text-white hover:bg-white/10"
                >
                  See the workflow
                </Button>
              </Link>
            </div>
            <p className="mt-5 text-sm text-ice/80">
              Start safely: observe first, require approval by default, expand autonomy only when
              ready.
            </p>
          </div>

          <div className="rounded-lg border border-white/15 bg-white/[0.07] p-4 shadow-2xl backdrop-blur sm:p-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-ice">
                  Incident workflow
                </p>
                <p className="mt-1 font-display text-lg font-semibold">Payment API latency spike</p>
              </div>
              <span className="rounded-full border border-ice/30 bg-white/10 px-2.5 py-1 font-mono text-[11px] text-ice">
                INVESTIGATING
              </span>
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded border border-white/10 bg-navy-dark/40 p-3">
                <p className="text-xs font-medium text-ice">Evidence collected</p>
                <p className="mt-1 text-sm text-white">
                  Metrics and logs from the enabled monitoring connection
                </p>
              </div>
              <div className="rounded border border-white/10 bg-navy-dark/40 p-3">
                <p className="text-xs font-medium text-ice">Root-cause analysis</p>
                <p className="mt-1 text-sm text-white">
                  Claims are labeled as fact, inference, or hypothesis—and cite their evidence.
                </p>
              </div>
              <div className="rounded border border-info/60 bg-info/15 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-ice">Proposed action</p>
                  <span className="rounded-full border border-warning/60 bg-warning/20 px-2 py-0.5 font-mono text-[10px] text-white">
                    APPROVAL
                  </span>
                </div>
                <p className="mt-1 text-sm text-white">
                  A single action waits for the policy and approval your team configured.
                </p>
              </div>
              <div className="flex items-center gap-2 px-1 text-xs text-ice">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success text-[10px] text-white">
                  ✓
                </span>
                Verification reads the connected system again before resolution.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-5 text-center text-sm text-subink">
          <span className="font-medium text-ink">
            Connect the systems your on-call team already uses
          </span>
          <span>Datadog</span>
          <span>Jira</span>
          <span>ServiceNow</span>
          <span>Microsoft Fabric</span>
          <span>MCP servers</span>
        </div>
      </section>

      <section id="controls" className="scroll-mt-6 px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <span className="kicker">Why teams can trust the workflow</span>
            <h2 className="mt-3 font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">
              Useful AI for the investigation. Deterministic controls for the risky part.
            </h2>
            <p className="mt-4 text-lg leading-7 text-subink">
              Resolution is designed for production operations, where a plausible answer is not
              enough and an unreviewed change can make an incident worse.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {outcomes.map((outcome, index) => (
              <article
                key={outcome.title}
                className="rounded-lg border border-border bg-surface p-6 shadow-sm"
              >
                <span className="font-mono text-xs font-medium text-info">0{index + 1}</span>
                <h3 className="mt-5 font-display text-xl font-semibold text-ink">
                  {outcome.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-subink">{outcome.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="workflow"
        className="scroll-mt-6 border-y border-border bg-surface px-6 py-20 sm:py-24"
      >
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
          <div className="max-w-md">
            <span className="kicker">From alert to answer</span>
            <h2 className="mt-3 font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">
              Designed for the complete incident, not just the first alert.
            </h2>
            <p className="mt-4 text-lg leading-7 text-subink">
              Bring incidents in from the tools you use. Give the agent only the approved
              capabilities it needs. Keep a clear, auditable record of what it found, proposed, and
              changed.
            </p>
            <div className="mt-7">
              <ArrowLink href="/signup">Set up a safe first workflow</ArrowLink>
            </div>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {workflow.map(([number, title, body]) => (
              <li key={number} className="rounded-lg border border-border bg-background p-5">
                <span className="font-mono text-xs font-medium text-info">{number}</span>
                <h3 className="mt-4 font-display text-lg font-semibold text-ink">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-subink">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-navy-dark px-6 py-20 text-white sm:py-24">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <span className="kicker">Build confidence before autonomy</span>
            <h2 className="mt-3 font-display text-3xl font-semibold leading-tight sm:text-4xl">
              Give on-call engineers a faster path from signal to safe action.
            </h2>
            <p className="mt-4 text-lg leading-7 text-ice">
              Create a workspace, connect one incident source, and choose the controls that match
              your team&apos;s tolerance for automation.
            </p>
          </div>
          <Link href="/signup" className="shrink-0">
            <Button size="lg">Create your workspace</Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
