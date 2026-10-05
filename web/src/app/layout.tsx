import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppHeader from "@/components/AppHeader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Synapse", template: "%s – Synapse" },
  description: "Local-first collaborative workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <a href="#main" className="skip-link">Skip to main content</a>
        <AppHeader />
        {/* One main landmark for every page; tabIndex lets the skip link move focus into it */}
        <main id="main" tabIndex={-1}>{children}</main>
      </body>
    </html>
  );
}
