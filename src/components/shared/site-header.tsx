"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircuitBoard, Menu, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { FeedbackDialog } from "@/components/shared/feedback-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const NAV = [
  { href: "/theory", label: "Theory" },
  { href: "/lab", label: "Lab" },
  { href: "/report", label: "Report" },
  { href: "/manual", label: "Manual" },
] as const;

/**
 * On a phone the four links, the wordmark, the theme toggle and the feedback
 * button do not fit on one 360px row — and the old header simply let them
 * collide. Below `sm` the nav collapses into a sheet; the wordmark and the
 * toggle stay, because those are the two things you always want reachable.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <header className="bg-background/80 no-print sticky top-0 z-50 border-b backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-6 sm:px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
          <CircuitBoard className="text-logic-high size-5" />
          <span>Gatelab</span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                isActive(href)
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <FeedbackDialog>
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
              <MessageSquare /> Feedback
            </Button>
          </FeedbackDialog>

          <ThemeToggle />

          {/* --- mobile --- */}
          <Sheet open={menu} onOpenChange={setMenu}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="sm:hidden">
                <Menu />
                <span className="sr-only">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <CircuitBoard className="text-logic-high size-5" />
                  Gatelab
                </SheetTitle>
              </SheetHeader>

              <nav className="flex flex-col gap-1 px-4">
                {NAV.map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMenu(false)}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm transition-colors",
                      isActive(href)
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </Link>
                ))}

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
