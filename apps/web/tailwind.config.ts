import type { Config } from "tailwindcss";
// Imported by relative path directly into tokens.ts (not the "@resolution/ui" package
// barrel) — the barrel also re-exports React components (status-badge.tsx), and the
// config-file loader Next/Tailwind use to parse tailwind.config.ts (jiti) can't resolve
// that transitively at config-parse time. tokens.ts itself has no React dependency.
import { colors, radius, typography } from "../../packages/ui/src/tokens";

// Wires the design tokens (packages/ui/src/tokens.ts) into Tailwind so no component ever
// hardcodes a hex value — BUILD spec §13. CSS variables (defined in app/globals.css) back
// every color here so light/dark/explicit-theme all resolve through one source.
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "var(--navy)",
        "navy-dark": "var(--navy-dark)",
        ice: "var(--ice)",
        background: "var(--background)",
        surface: "var(--surface)",
        border: "var(--border)",
        ink: "var(--ink)",
        subink: "var(--subink)",
        success: colors.status.success,
        warning: colors.status.warning,
        error: colors.status.error,
        critical: colors.status.critical,
        info: colors.status.info,
      },
      fontFamily: {
        display: typography.fontDisplay.split(",").map((f) => f.trim().replace(/"/g, "")),
        body: typography.fontBody.split(",").map((f) => f.trim().replace(/"/g, "")),
        mono: typography.fontMono.split(",").map((f) => f.trim().replace(/"/g, "")),
      },
      borderRadius: {
        DEFAULT: radius.md,
        sm: radius.sm,
        lg: radius.lg,
        full: radius.full,
      },
    },
  },
  plugins: [],
};

export default config;
