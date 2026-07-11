"use client";

import { useState } from "react";
import { Check, Target, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSpecStore } from "@/stores/spec-store";
import { parseInput } from "@/lib/core-engine/canonical";

const EXAMPLES = [
  "F(A,B) = A ^ B",
  "F(A,B,C) = A'B + BC",
  "F(S,A,B) = S'*A + S*B",
] as const;

/**
 * Set the target function FROM INSIDE THE LAB.
 *
 * The lab used to be a dead end without the theory workspace: the only way to
 * tell it what you were building was to go and minimize something first. But
 * "here is a function, wire it up and check my work" is a completely reasonable
 * way to start, and it is how a lab sheet is actually written. The lab is now a
 * standalone tool that HAPPENS to interoperate with the theory one, rather than
 * an appendix to it.
 */
export function TargetInput() {
  const source = useSpecStore((s) => s.source);
  const setSpec = useSpecStore((s) => s.setSpec);
  const clear = useSpecStore((s) => s.clear);

  const [editing, setEditing] = useState(!source);
  const [draft, setDraft] = useState(source ?? "");

  const parsed = draft.trim() ? parseInput(draft) : null;
  const error =
    parsed && !parsed.ok
      ? (parsed.diagnostics[0]?.message ?? "Could not parse that.")
      : null;

  if (!editing && source) {
    return (
      <div className="flex items-start gap-2 p-3">
        <Target className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-xs">Building</p>
          <code className="text-sm break-words">{source}</code>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setDraft(source);
            setEditing(true);
          }}
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3">
      <p className="text-muted-foreground text-xs">
        What are you building? Type the target function and the lab will check your
        circuit against it, row by row.
      </p>

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && parsed?.ok) {
              setSpec(draft.trim());
              setEditing(false);
            }
            if (e.key === "Escape" && source) setEditing(false);
          }}
          placeholder="F(A,B,C) = A'B + BC"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!error}
          className="h-8 font-mono text-xs"
        />
        <Button
          size="sm"
          className="shrink-0"
          disabled={!parsed?.ok}
          onClick={() => {
            setSpec(draft.trim());
            setEditing(false);
          }}
        >
          <Check />
        </Button>
        {source && (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={() => setEditing(false)}
          >
            <X />
          </Button>
        )}
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      <div className="flex flex-wrap gap-1">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setDraft(ex)}
            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded border px-1.5 py-0.5 font-mono text-[10px]"
          >
            {ex}
          </button>
        ))}
        {source && (
          <button
            type="button"
            onClick={() => {
              clear();
              setDraft("");
            }}
            className="text-muted-foreground hover:text-destructive px-1.5 py-0.5 text-[10px]"
          >
            clear target
          </button>
        )}
      </div>
    </div>
  );
}
