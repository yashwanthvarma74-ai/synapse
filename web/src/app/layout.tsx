import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@yashwanthvarma74/react/styles.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/components.css";
import "@/styles/layout.css";
import "@/styles/pages.css";
import "@/styles/document.css";
import "@/styles/board.css";
import AppHeader from "@/components/layout/AppHeader";
import Providers from "@/components/layout/Providers";
import SiteFooter from "@/components/layout/SiteFooter";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://synapse-app-beta.vercel.app";
const DESCRIPTION = "Local-first, real-time collaborative documents and canvas built on CRDTs. Edits apply on your device first and replicas converge without conflicts after any network partition. Open source.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Synapse – local-first, real-time collaborative workspace", template: "%s – Synapse" },
  description: DESCRIPTION,
  authors: [{ name: "Yashwanth Varma", url: "https://github.com/yashwanthvarma74-ai" }],
  creator: "Yashwanth Varma",
  openGraph: {
    type: "website",
    siteName: "Synapse",
    title: "Synapse – local-first, real-time collaborative workspace",
    description: DESCRIPTION,
    images: [{ url: "/social.jpg", width: 1200, height: 630, alt: "Synapse: a shared document and whiteboard" }],
  },
  twitter: { card: "summary_large_image", title: "Synapse – local-first, real-time collaborative workspace", description: DESCRIPTION, images: ["/social.jpg"] },
};

// data-theme is fixed to light: Synapse is a light-only app, though the design system also has dark and high contrast.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" className={inter.variable}>
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
