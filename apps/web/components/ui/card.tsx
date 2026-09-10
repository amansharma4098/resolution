import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * White surface, 1px border, restrained shadow — never a colored left-edge stripe or top
 * accent bar (BUILD spec §13). Pass `emphasized` to render the navy/ice "recommended" fill
 * used for a single highlighted card in a set (e.g. the active pipeline stage).
 */
export function Card({
  className,
  emphasized,
  ...props
}: HTMLAttributes<HTMLDivElement> & { emphasized?: boolean }) {
  return (
    <div
      className={cn(
        "rounded border shadow-sm",
        emphasized
          ? "border-navy bg-navy text-white"
          : "border-border bg-surface text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-4 pb-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-display text-lg font-semibold leading-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-subink", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-2", className)} {...props} />;
}
