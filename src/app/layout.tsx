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

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const DESCRIPTION =
  "Digital logic design lab assistant — Boolean minimization, K-maps, and a 74xx TTL circuit sandbox that checks the circuit you built against the algebra you derived.";

export const metadata: Metadata = {
  metadataBase: new URL("https://gatelab-online.vercel.app"),
  title: { default: "Gatelab", template: "%s · Gatelab" },
  description: DESCRIPTION,
  openGraph: {
    title: "Gatelab",
    description: DESCRIPTION,
    url: "https://gatelab-online.vercel.app",
    siteName: "Gatelab",
    type: "website",
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
