"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CATEGORY_LABELS, searchProblems, type Problem } from "@/lib/diagram/problems";
import { cn } from "@/lib/utils";

/**
 * The question list.
 *
 * Ordered by question NUMBER, not by topic, because that is the handle a student
 * actually has — they are holding a sheet that says "34", and making them work
 * out that 34 is a memory question before they can find it is a worse tool than
 * a printed index.
 */
export function ProblemList({
  query,
  onQuery,
  selected,
  onSelect,
  className,
}: {
  query: string;
  onQuery: (q: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const results = searchProblems(query);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="relative p-3 pb-2">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-6 size-3.5 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Question number, topic, or a word from it"
          className="h-9 pl-8 text-sm"
          aria-label="Search questions"
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ul className="space-y-0.5 p-2 pt-0">
          {results.map((p) => (
            <li key={p.id}>
              <ProblemRow
                problem={p}
                active={p.id === selected}
                onSelect={() => onSelect(p.id)}
              />
            </li>
          ))}
          {results.length === 0 && (
            <li className="text-muted-foreground px-3 py-8 text-center text-sm">
              Nothing matches “{query}”.
            </li>
          )}
        </ul>
      </ScrollArea>

      <div className="text-muted-foreground border-t px-3 py-2 text-[11px]">
        {results.length} of {searchProblems("").length} questions
      </div>
    </div>
  );
}

function ProblemRow({
  problem,
  active,
  onSelect,
}: {
  problem: Problem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "w-full rounded-md px-3 py-2 text-left transition-colors",
        active ? "bg-secondary text-secondary-foreground" : "hover:bg-accent/60",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "shrink-0 font-mono text-xs tabular-nums",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {problem.number}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{problem.title}</span>
      </div>
      <Badge
        variant="outline"
        className="mt-1 h-4 px-1.5 text-[10px] font-normal"
      >
        {CATEGORY_LABELS[problem.category]}
      </Badge>
    </button>
  );
}
