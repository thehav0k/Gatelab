import Link from "next/link";
import { ArrowLeft, BookOpen, Cpu, Home, Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
      <div className="w-full max-w-xl text-center">
        {/* Logic state badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-mono font-medium text-amber-500">
          <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
          FAULT 404 · STATE Z (HIGH-IMPEDANCE)
        </div>

        <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
          Signal lost: Page not found
        </h1>
        <p className="mt-3 text-base text-muted-foreground">
          The pin or wire you are probing doesn&apos;t connect to anything on this
          board. It may have been unseated, re-routed, or left floating.
        </p>

        {/* Quick action cards */}
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 text-left">
          <Link
            href="/"
            className="group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:border-foreground/40 hover:bg-muted/40"
          >
            <Home className="mt-0.5 size-5 shrink-0 text-muted-foreground group-hover:text-foreground" />
            <div>
              <div className="text-sm font-medium">Home</div>
              <div className="text-xs text-muted-foreground">
                Overview of Gatelab features
              </div>
            </div>
          </Link>

          <Link
            href="/lab"
            className="group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:border-foreground/40 hover:bg-muted/40"
          >
            <Cpu className="mt-0.5 size-5 shrink-0 text-muted-foreground group-hover:text-foreground" />
            <div>
              <div className="text-sm font-medium">TTL Logic Lab</div>
              <div className="text-xs text-muted-foreground">
                Digital trainer & breadboard sandbox
              </div>
            </div>
          </Link>

          <Link
            href="/theory?tab=build"
            className="group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:border-foreground/40 hover:bg-muted/40"
          >
            <Sigma className="mt-0.5 size-5 shrink-0 text-muted-foreground group-hover:text-foreground" />
            <div>
              <div className="text-sm font-medium">Theory & Circuit Synthesizer</div>
              <div className="text-xs text-muted-foreground">
                Minimizer, K-maps, and Build it
              </div>
            </div>
          </Link>

          <Link
            href="/manual"
            className="group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:border-foreground/40 hover:bg-muted/40"
          >
            <BookOpen className="mt-0.5 size-5 shrink-0 text-muted-foreground group-hover:text-foreground" />
            <div>
              <div className="text-sm font-medium">User Manual</div>
              <div className="text-xs text-muted-foreground">
                Step-by-step guides and reference
              </div>
            </div>
          </Link>
        </div>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Button asChild variant="outline">
            <Link href="/" className="gap-2">
              <ArrowLeft className="size-4" /> Back to Safety
            </Link>
          </Button>
          <Button asChild>
            <Link href="/manual">Read the Manual</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
