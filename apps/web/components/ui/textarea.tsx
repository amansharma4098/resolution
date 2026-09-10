import { type TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-subink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
