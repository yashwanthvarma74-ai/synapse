import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppHeader from "@/components/AppHeader";
import Providers from "@/components/Providers";
import SiteFooter from "@/components/SiteFooter";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://synapse-app-beta.vercel.app";
const DESCRIPTION = "Write documents and sketch on a whiteboard together, live. It keeps working with no internet and merges everyone's changes when you reconnect. Try it in one click, no sign-up.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Synapse – write together, even offline", template: "%s – Synapse" },
  description: DESCRIPTION,
  authors: [{ name: "Yashwanth Varma", url: "https://github.com/yashwanthvarma74-ai" }],
  creator: "Yashwanth Varma",
  openGraph: {
    type: "website",
    siteName: "Synapse",
    title: "Synapse – write together, even offline",
    description: DESCRIPTION,
    images: [{ url: "/social.jpg", width: 800, height: 512, alt: "Synapse: a shared document and whiteboard" }],
  },
  twitter: { card: "summary_large_image", title: "Synapse – write together, even offline", description: DESCRIPTION, images: ["/social.jpg"] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <Providers>
          <a href="#main" className="skip-link">Skip to main content</a>
          <AppHeader />
          {/* One main landmark for every page; tabIndex lets the skip link move focus into it */}
          <main id="main" tabIndex={-1}>{children}</main>
        </Providers>
        <SiteFooter />
      </body>
    </html>
  );
}
