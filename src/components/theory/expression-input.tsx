"use client";

import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Diagnostic } from "@/lib/core-engine/types";

const EXAMPLES = [
  "A'B + BC'",
  "F(A,B,C,D) = Σm(0,1,2,5,6,7)",
  "F(A,B,C,D) = Σm(1,3,7,11,15) + d(0,2,5)",
  "(A + B)(A' + C)",
  "A ^ B ^ C",
] as const;

const ICON = {
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info,
} as const;

interface Props {
  value: string;
  onChange: (next: string) => void;
  diagnostics: readonly Diagnostic[];
}

export function ExpressionInput({ value, onChange, diagnostics }: Props) {
  const errors = diagnostics.filter((d) => d.severity === "error");
  const notes = diagnostics.filter((d) => d.severity !== "error");

  return (
    <div className="space-y-3">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="A'B + BC'   ·   F(A,B,C) = Σm(0,2,5) + d(6)"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={errors.length > 0}
        className={cn(
          "h-11 font-mono text-base md:text-base",
          errors.length > 0 && "border-destructive focus-visible:ring-destructive/40",
        )}
      />

      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => onChange(ex)}>
            <Badge
              variant="secondary"
              className="hover:bg-accent cursor-pointer font-mono font-normal"
            >
              {ex}
            </Badge>
          </button>
        ))}
      </div>

      {[...errors, ...notes].map((d, i) => {
        const Icon = ICON[d.severity];
        return (
          <Alert
            key={`${d.code}-${i}`}
            variant={d.severity === "error" ? "destructive" : "default"}
          >
            <Icon />
            <AlertTitle className="font-mono text-xs">{d.code}</AlertTitle>
            <AlertDescription>
              {d.message}
              {/* Underline the offending span — the whole reason diagnostics carry
                  one instead of being thrown strings. */}
              {d.severity === "error" && d.span.end > d.span.start && (
                <pre className="text-muted-foreground mt-1 font-mono text-xs">
                  {value}
                  {"\n"}
                  {" ".repeat(d.span.start)}
                  {"~".repeat(Math.max(1, d.span.end - d.span.start))}
                </pre>
              )}
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
