"use client";

import { useState } from "react";
import { ListTree, Paintbrush } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ProblemList } from "@/components/diagrams/problem-list";
import { SolutionView } from "@/components/diagrams/solution-view";
import { StylePanel } from "@/components/diagrams/style-panel";
import { PROBLEMS, getProblem } from "@/lib/diagram/problems";
import { useDiagramStore, useDiagramTheme } from "@/stores/diagram-store";
import { useHydrated } from "@/hooks/use-hydrated";
import { useIsCompact } from "@/hooks/use-media-query";

/**
 * The block-diagram workspace.
 *
 * Three columns, and the middle one is the only one that is ever the point: pick
 * a question on the left, read the answer in the middle, and change how it is
 * PAINTED on the right. Style is a sibling of the answer, not a setting buried in
 * a menu, because for most people here the export IS the deliverable — the figure
 * has to match the document it is going into before it is worth downloading.
 */
const FIRST_DRAWN =
  PROBLEMS.find((p) => p.category === "circuit") ?? PROBLEMS[0];

export default function DiagramsPage() {
  const theme = useDiagramTheme();
  // Which question is open lives in the persisted store, not in local state, for
  // the same reason the theory expression does: it is a place in a document, and
  // navigating to the lab and back should not lose it. `getProblem` guards the
  // stored id, so a renamed question falls back rather than rendering nothing.
  const stored = useDiagramStore((s) => s.lastProblem);
  const setLastProblem = useDiagramStore((s) => s.setLastProblem);
  const hydrated = useHydrated();
  // First visit lands on the first question that HAS a drawing. Question 1 is
  // numerically first and is an essay — opening a page called Diagrams on a wall
  // of prose is a bad first answer to "what does this do".
  const problem = (hydrated && stored ? getProblem(stored) : undefined) ?? FIRST_DRAWN;
  const selected = problem?.id ?? null;

  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const compact = useIsCompact();

  const pick = (id: string) => {
    setLastProblem(id);
    setListOpen(false);
  };

  return (
    <div className="mx-auto w-full max-w-[100rem] px-4 py-5 sm:px-6 sm:py-6">
      <header className="mb-4 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Diagrams</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm text-pretty">
            Block and circuit diagrams for the standard digital-logic problems —
            decoders, multiplexers, adders, counters and memory expansion. Every
            one is generated from the problem, not stored as a picture, so you can
            change the width and get a correct answer to a different question.
          </p>
        </div>

        {compact && (
          <div className="ml-auto flex gap-2">
            <Sheet open={listOpen} onOpenChange={setListOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  <ListTree /> Questions
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0">
                <SheetHeader className="border-b">
                  <SheetTitle>Questions</SheetTitle>
                </SheetHeader>
                <ProblemList
                  query={query}
                  onQuery={setQuery}
                  selected={selected}
                  onSelect={pick}
                  className="h-[calc(100dvh-4.5rem)]"
                />
              </SheetContent>
            </Sheet>

            <Sheet open={styleOpen} onOpenChange={setStyleOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  <Paintbrush /> Style
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80">
                <SheetHeader>
                  <SheetTitle>Diagram style</SheetTitle>
                </SheetHeader>
                <ScrollArea className="h-[calc(100dvh-5rem)]">
                  <div className="px-4 pb-8">
                    <StylePanel theme={theme} />
                  </div>
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>
        )}
      </header>

      <div className="flex gap-5">
        {!compact && (
          <aside className="bg-card sticky top-[4.5rem] h-[calc(100dvh-6rem)] w-72 shrink-0 overflow-hidden rounded-md border">
            <ProblemList
              query={query}
              onQuery={setQuery}
              selected={selected}
              onSelect={pick}
              className="h-full"
            />
          </aside>
        )}

        <main className="min-w-0 flex-1">
          {problem && <SolutionView problem={problem} theme={theme} />}
        </main>

        {!compact && (
          <aside className="bg-card sticky top-[4.5rem] h-[calc(100dvh-6rem)] w-72 shrink-0 overflow-hidden rounded-md border xl:w-80">
            <div className="border-b px-4 py-2.5">
              <h2 className="text-sm font-medium">Diagram style</h2>
              <p className="text-muted-foreground text-[11px]">
                Applies to every figure, and to what you export.
              </p>
            </div>
            <ScrollArea className="h-[calc(100%-3.4rem)]">
              <div className="p-4">
                <StylePanel theme={theme} />
              </div>
            </ScrollArea>
          </aside>
        )}
      </div>
    </div>
  );
}
