"use client";

import { useState } from "react";
import { TLink as Link } from "@/components/motion/transition-link";
import { usePathname } from "next/navigation";
import { CircuitBoard, Menu, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { FeedbackDialog } from "@/components/shared/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { QuickstartTutorial } from "@/components/quickstart/quickstart-tutorial";
import { InstallPwaButton } from "@/components/pwa/install-pwa-button";

const NAV = [
  { href: "/theory", label: "1. Theory" },
  { href: "/diagram", label: "2. Diagram" },
  { href: "/lab", label: "3. Lab" },
  { href: "/report", label: "4. Report" },
  { href: "/manual", label: "Manual" },
] as const;

/**
 * On a phone the nav links, the wordmark, the theme toggle and the feedback
 * button do not fit on one 360px row — and the old header simply let them
 * collide. Below `md` the nav collapses into a sheet; the wordmark and the
 * toggle stay, because those are the two things you always want reachable.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const [quickstartOpen, setQuickstartOpen] = useState(false);
  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <header className="site-header bg-background/80 print:hidden no-print sticky top-0 z-50 border-b backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-6 sm:px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <CircuitBoard className="text-logic-high size-5" />
          <span>Gatelab</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.slice(0, 4).map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isActive(href)
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
          <Separator orientation="vertical" className="mx-1 h-4" />
          <Link
            href="/manual"
            aria-current={isActive("/manual") ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive("/manual")
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Manual
          </Link>

          <Dialog open={quickstartOpen} onOpenChange={setQuickstartOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Quickstart
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto p-6">
              <DialogHeader className="sr-only">
                <DialogTitle>Quickstart Tutorial</DialogTitle>
              </DialogHeader>
              <QuickstartTutorial onClose={() => setQuickstartOpen(false)} />
            </DialogContent>
          </Dialog>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <InstallPwaButton />

          <FeedbackDialog>
            <Button variant="ghost" size="sm" className="hidden lg:inline-flex">
              <MessageSquare /> Feedback
            </Button>
          </FeedbackDialog>

          <ThemeToggle />

          {/* --- mobile --- */}
          <Sheet open={menu} onOpenChange={setMenu}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden min-h-[44px] min-w-[44px]"
                aria-label="Navigation menu"
                aria-expanded={menu}
                aria-controls="mobile-nav-menu"
              >
                <Menu className="size-5" />
                <span className="sr-only">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64">
              <SheetHeader>
                <SheetTitle asChild>
                  <Link
                    href="/"
                    onClick={() => setMenu(false)}
                    className="flex items-center gap-2"
                  >
                    <CircuitBoard className="text-logic-high size-5" />
                    <span>Gatelab</span>
                  </Link>
                </SheetTitle>
              </SheetHeader>

              <nav id="mobile-nav-menu" className="flex flex-col gap-1 px-4">
                {NAV.slice(0, 4).map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    aria-current={isActive(href) ? "page" : undefined}
                    onClick={() => setMenu(false)}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isActive(href)
                        ? "bg-secondary text-secondary-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </Link>
                ))}

                <Separator className="my-1.5" />

                <Link
                  href="/manual"
                  aria-current={isActive("/manual") ? "page" : undefined}
                  onClick={() => setMenu(false)}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive("/manual")
                      ? "bg-secondary text-secondary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Manual
                </Link>

                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    setQuickstartOpen(true);
                  }}
                  className="rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer"
                >
                  Quickstart
                </button>

                {/* Do NOT close the sheet here: this dialog is a child of it, and
                    unmounting the sheet would take the open dialog with it. */}
                <FeedbackDialog>
                  <Button variant="outline" size="sm" className="mt-3 w-full">
                    <MessageSquare /> Send feedback
                  </Button>
                </FeedbackDialog>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

