import type { Metadata } from "next";
import { SessionProvider } from "@/hooks/use-session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resolution — AI incident resolution with guardrails",
  description:
    "Turn production alerts into evidence-backed, policy-gated, verified recovery across your monitoring, ITSM and operational systems.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
