"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircuitBoard } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/shared/theme-toggle";

const NAV = [
  { href: "/theory", label: "Theory" },
  { href: "/lab", label: "Lab" },
  { href: "/report", label: "Report" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="bg-background/80 no-print sticky top-0 z-50 border-b backdrop-blur">
      <div className="flex h-14 items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <CircuitBoard className="text-logic-high size-5" />
          <span>DigiLab Studio</span>
        </Link>

        <nav className="flex items-center gap-1">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                pathname.startsWith(href)
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
