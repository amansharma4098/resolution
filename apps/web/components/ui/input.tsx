import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded border border-border bg-surface px-3 text-sm text-ink placeholder:text-subink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
