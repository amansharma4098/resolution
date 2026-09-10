import type { Metadata } from "next";
import { SessionProvider } from "@/hooks/use-session";
import "./globals.css";

export const metadata: Metadata = {
  title: "resolution — AI Incident Resolution Platform",
  description:
    "An AI agent that investigates, diagnoses, remediates and verifies production incidents across your ITSM, monitoring, cloud, data and infrastructure systems.",
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
