"use client";

import { useMemo } from "react";
import { Cable, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { freeSpaceBelow, mergeDocument } from "@/lib/diagram/editor/ops";
import { parseSpec, sigmaOf } from "@/lib/diagram/editor/spec";
import {
  AUTO_WIRABLE,
  IMPLEMENTATIONS,
  autoWire,
  buildImplementation,
  type Implementation,
} from "@/lib/diagram/editor/synthesize";
import type { DiagramTheme } from "@/lib/diagram/theme";
import { useBuilderStore } from "@/stores/builder-store";
import { useDiagramStore } from "@/stores/diagram-store";

/**
 * Build a circuit from an equation, or wire up the block you have selected.
 *
 * TWO DOORS INTO THE SAME SYNTHESIS. "Build it for me" places the parts and
 * wires them; "wire up this decoder" takes the part you deliberately chose and
 * grows the rest of the circuit around it. The second is the one that matters
 * when the question dictates the component — "implement f using a 3-to-8
 * decoder" is not asking you to accept whatever the tool would have picked.
 *
 * What comes out is an ordinary document: real parts, real wires, all of it
 * draggable and re-parameterisable afterwards. That is the difference between
 * this and pasting in a picture.
 */
export function SynthesisPanel({ theme }: { theme: DiagramTheme }) {
  const doc = useBuilderStore((s) => s.doc);
  const selection = useBuilderStore((s) => s.selection);
  const commit = useBuilderStore((s) => s.commit);
  const select = useBuilderStore((s) => s.select);
  const text = useBuilderStore((s) => s.specText);
  const setText = useBuilderStore((s) => s.setSpecText);

  const implementation = useDiagramStore((s) => s.implementation);
  const setImplementation = useDiagramStore((s) => s.setImplementation);

  const parsed = useMemo(() => parseSpec(text), [text]);

  const soleSelected = selection.length === 1 ? doc.instances[selection[0] as string] : undefined;
  const wirable = soleSelected && AUTO_WIRABLE.has(soleSelected.part) ? soleSelected : undefined;

  const build = () => {
    if (!parsed.ok) return;
    const result = buildImplementation(parsed.value.specs, implementation, theme);
    if (!result.ok) {
      toast.error("Could not build that", { description: result.reason });
      return;
    }
    const merged = mergeDocument(doc, result.value.doc, freeSpaceBelow(doc));
    commit(merged.doc);
    select(merged.ids);
    toast.success(
      `Built ${parsed.value.specs.map((s) => s.name).join(", ")}`,
      { description: result.value.notes[0] ?? "Added below what was already there." },
    );
  };

  const wire = () => {
    if (!parsed.ok || !wirable) return;
    const result = autoWire(doc, wirable.id, parsed.value.specs);
    if (!result.ok) {
      toast.error("Could not wire that up", { description: result.reason });
      return;
    }
    commit(result.doc);
    select([wirable.id, ...result.ids]);
    toast.success("Wired", { description: result.notes[0] ?? "" });
  };

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1.5">
        <Label htmlFor="spec" className="text-xs">
          The function
        </Label>
        <Textarea
          id="spec"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={4}
          className="resize-y font-mono text-xs"
          placeholder={"F(A,B,C) = A'B + BC'"}
        />
        <p className="text-muted-foreground text-[11px] text-pretty">
          An expression, a minterm list, or the output column — whichever your
          question gave you. One function per line; the first line&apos;s variables
          carry to the rest.
        </p>
        <pre className="text-muted-foreground bg-muted/40 overflow-x-auto rounded border px-2 py-1.5 font-mono text-[10px] leading-relaxed">
{`F(A,B,C) = A'B + BC'
F(A,B,C) = Σm(1,3,5) + d(7)
F(A,B,C) = 01101001`}
        </pre>
      </div>

      {!parsed.ok ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Not understood</AlertTitle>
          <AlertDescription>
            {parsed.diagnostics[0]?.message ?? "Check the syntax."}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="bg-muted/40 space-y-1 rounded-md border p-2.5 font-mono text-[11px]">
          {parsed.value.specs.map((spec) => (
            <p key={spec.name}>{sigmaOf(spec)}</p>
          ))}
          <Separator className="my-1.5" />
          {parsed.value.minimal.map((m, i) => (
            <p key={i} className="text-muted-foreground">
              {m}
            </p>
          ))}
        </div>
      )}

      {parsed.ok &&
        parsed.value.diagnostics
          .filter((d) => d.severity === "warning")
          .map((d, i) => (
            <p key={i} className="text-logic-z text-[11px] text-pretty">
              {d.message}
            </p>
          ))}

      <Separator />

      <div className="space-y-1.5">
        <Label className="text-xs">Implement it with</Label>
        <Select
          value={implementation}
          onValueChange={(v) => setImplementation(v as Implementation)}
        >
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IMPLEMENTATIONS.map((impl) => (
              <SelectItem key={impl.id} value={impl.id} className="text-xs">
                {impl.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-[11px] text-pretty">
          {IMPLEMENTATIONS.find((i) => i.id === implementation)?.summary}
        </p>
      </div>

      <Button className="w-full" onClick={build} disabled={!parsed.ok}>
        <Sparkles />
        Build it on the canvas
      </Button>

      <Separator />

      <div className="space-y-2">
        <Label className="text-xs">Or wire up what you placed</Label>
        {wirable ? (
          <>
            <Button variant="outline" className="w-full" onClick={wire} disabled={!parsed.ok}>
              <Cable />
              Auto-wire this {wirable.part}
            </Button>
            <p className="text-muted-foreground text-[11px] text-pretty">
              Grows the inputs, the collecting logic and the outputs around the block
              you selected. Pins you have already wired are left alone.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-[11px] text-pretty">
            Select a <strong>decoder</strong> or a <strong>multiplexer</strong>{" "}
            on the canvas and this will wire it to the function above — the answer to
            &ldquo;implement f using a 3-to-8 decoder&rdquo;, where the part is
            dictated and only the wiring is yours to work out.
          </p>
        )}
      </div>
    </div>
  );
}
