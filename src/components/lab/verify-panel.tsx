"use client";

import { useMemo } from "react";
import { CircleCheck, Lightbulb, OctagonX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCircuitStore } from "@/stores/circuit-store";
import { useExpected, useSpecStore } from "@/stores/spec-store";
import { TargetInput } from "./target-input";
import { verify } from "@/lib/simulation/verify";
import { LOGIC_NAMES, type Logic } from "@/lib/simulation/logic";
import { DONT_CARE } from "@/lib/core-engine/types";
import { cn } from "@/lib/utils";

/**
 * The verification bridge, on screen.
 *
 * "Your circuit is wrong on rows 2 and 5" is a grade. "You appear to have
 * swapped A and B" is a lesson. The hypotheses are the point.
 */
export function VerifyPanel() {
  const doc = useCircuitStore((s) => s.doc);
  const expected = useExpected();
  const source = useSpecStore((s) => s.source);

  const result = useMemo(
    () => (expected ? verify(doc, expected) : null),
    [doc, expected],
  );

  // The target is set HERE, in the lab. It no longer requires a trip through the
  // theory workspace — see target-input.tsx.
  if (!expected || !source || !result) {
    return (
      <div>
        <TargetInput />
        {source && !expected && (
          <p className="text-destructive px-3 pb-3 text-xs">
            That target will not parse. Fix it above.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="-mx-3 -mt-3 border-b">
        <TargetInput />
      </div>

      {result.error ? (
        <Alert>
          <OctagonX />
          <AlertTitle>Cannot check yet</AlertTitle>
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      ) : result.ok ? (
        <Alert>
          <CircleCheck className="text-logic-high" />
          <AlertTitle>Verified</AlertTitle>
          <AlertDescription>
            Your circuit matches {expected.name} on all {result.rows.length} rows.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <OctagonX />
          <AlertTitle>
            {result.nonCombinational
              ? "This circuit has memory"
              : `${result.mismatches.length} row${
                  result.mismatches.length === 1 ? "" : "s"
                } disagree`}
          </AlertTitle>
          <AlertDescription>
            {result.nonCombinational
              ? "It cannot be described by a truth table."
              : `Your circuit differs from ${expected.name} on the highlighted rows below.`}
          </AlertDescription>
        </Alert>
      )}

      {/* The hypotheses — the actual teaching product. */}
      {result.hypotheses.map((h, i) => (
        <Alert key={i}>
          <Lightbulb className="text-logic-z" />
          <AlertTitle>Likely cause</AlertTitle>
          <AlertDescription>{h.message}</AlertDescription>
        </Alert>
      ))}

      {result.rows.length > 0 && (
        <ScrollArea className="h-[300px] rounded-md border">
          <table className="w-full font-mono text-xs">
            <thead className="bg-muted/50 sticky top-0 backdrop-blur">
              <tr className="border-b">
                {result.inputLabels.map((l) => (
                  <th key={l} className="px-2 py-1.5 text-left font-medium">
                    {l}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-left font-medium">want</th>
                <th className="px-2 py-1.5 text-left font-medium">got</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  key={row.minterm}
                  className={cn(
                    "border-b last:border-0",
                    !row.ok && "bg-destructive/15",
                  )}
                >
                  {row.inputs.map((bit, i) => (
                    <td key={i} className="text-muted-foreground px-2 py-1">
                      {bit}
                    </td>
                  ))}
                  <td className="px-2 py-1">
                    {row.expected === DONT_CARE ? (
                      <span className="text-logic-z" title="don't-care — either answer is fine">
                        X
                      </span>
                    ) : (
                      row.expected
                    )}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1 font-semibold",
                      row.ok ? "text-logic-high" : "text-destructive",
                    )}
                  >
                    {LOGIC_NAMES[row.actual as Logic]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}

      {result.mismatches.length > 0 && result.mismatches[0] && (
        <p className="text-muted-foreground text-xs">
          For example: with{" "}
          {result.inputLabels
            .map((l, i) => `${l}=${result.mismatches[0]?.inputs[i]}`)
            .join(", ")}{" "}
          your circuit outputs{" "}
          <Badge variant="outline" className="font-mono">
            {LOGIC_NAMES[result.mismatches[0].actual as Logic]}
          </Badge>{" "}
          but {expected.name} should be{" "}
          <Badge variant="outline" className="font-mono">
            {result.mismatches[0].expected}
          </Badge>
          .
        </p>
      )}
    </div>
  );
}
