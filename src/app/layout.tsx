import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/shared/theme-provider";
import { SiteHeader } from "@/components/shared/site-header";
import { SiteFooter } from "@/components/shared/site-footer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { KEYWORDS, SITE, jsonLd } from "@/lib/site";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  /**
   * The DEFAULT title is the home page's, and it is the single most load-bearing
   * string for being found: it is the blue link in the result. So it names what
   * someone would search for — "boolean minimizer", "k-map solver", "logic circuit
   * simulator" — rather than just the product name, which nobody is looking for yet.
   */
  title: { default: SITE.title, template: "%s · Gatelab" },
  description: SITE.description,
  keywords: [...KEYWORDS],
  applicationName: SITE.name,
  authors: [{ name: "thehav0k", url: "https://github.com/thehav0k" }],
  creator: "thehav0k",
  category: "education",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE.url,
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    locale: SITE.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.title,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  // Emits <meta name="google-site-verification" ...> into <head>. Going through
  // Next's metadata rather than hand-writing the tag keeps it deduplicated and
  // out of the way of the streaming head.
  verification: {
    google: "58NCdf8BCcG_wKTDjHdItVN5e43uO2y__vdAgtrmX6I",
  },
};

/**
 * `viewport-fit` and a locked initial scale, because the lab canvas swallows
 * touch gestures (`touch-action: none`) to pan and zoom itself. Without this the
 * browser's own pinch-zoom fights the canvas for the same fingers.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans", geist.variable, geistMono.variable)}
    >
      <body className="min-h-dvh antialiased">
        {/* Structured data, rendered on the SERVER — a crawler that runs no
            JavaScript still gets a full description of what this app is. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()) }}
        />
        <ThemeProvider>
          <TooltipProvider>
            <div className="flex min-h-dvh flex-col">
              <SiteHeader />
              <main className="flex flex-1 flex-col">{children}</main>
              <SiteFooter />
            </div>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
