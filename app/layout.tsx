import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentGate | Agent Security Workbench",
  description:
    "Test agent policies, investigate evidence, and compare release readiness.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
