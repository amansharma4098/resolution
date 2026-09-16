import { cn } from "@/lib/cn";

/**
 * Wordmark used on auth pages (and anywhere else a compact brand mark is needed). No
 * external asset — a navy/ice monogram square plus the display-font name, per the
 * palette in packages/ui/src/tokens.ts. Pass `dark` when placing it on a navy background.
 */
export function Logo({ className, dark = false }: { className?: string; dark?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        aria-hidden
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded font-display text-xs font-semibold",
          dark ? "bg-ice text-navy" : "bg-navy text-white",
        )}
      >
        FC
      </span>
      <span className={cn("font-display text-lg font-semibold", dark ? "text-white" : "text-ink")}>
        FixCaptain
      </span>
    </div>
  );
}
