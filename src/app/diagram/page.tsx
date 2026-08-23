"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Boxes, Paintbrush, SlidersHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BuilderCanvas } from "@/components/builder/builder-canvas";
import { BuilderToolbar } from "@/components/builder/builder-toolbar";
import { Inspector } from "@/components/builder/inspector";
import { PartPalette } from "@/components/builder/part-palette";
import { SynthesisPanel } from "@/components/builder/synthesis-panel";
import { StylePanel } from "@/components/diagrams/style-panel";
import {
  duplicate,
  GRID,
  group,
  offsetInstances,
  removeSelection,
  rotateInstances,
  ungroup,
} from "@/lib/diagram/editor/ops";
import type { DiagramTheme } from "@/lib/diagram/theme";
import { useBuilderStore } from "@/stores/builder-store";
import { useDiagramTheme } from "@/stores/diagram-store";
import { useIsCompact } from "@/hooks/use-media-query";

/**
 * The circuit builder.
 *
 * Palette on the left, canvas in the middle, properties on the right — the
 * layout every editor of this kind has, because it is the one that lets you keep
 * your eyes on the drawing while your hands are on either side of it.
 */
export default function DiagramBuilderPage() {
  const theme = useDiagramTheme();
  const compact = useIsCompact();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  useGlobalShortcuts(theme);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <BuilderToolbar theme={theme} />

      {compact && (
        <div className="flex gap-2 border-b px-3 py-2">
          <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <Boxes /> Blocks
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 p-0">
              <SheetHeader className="border-b">
                <SheetTitle>Blocks</SheetTitle>
              </SheetHeader>
              <PartPalette className="h-[calc(100dvh-4.5rem)]" />
            </SheetContent>
          </Sheet>

          <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal /> Properties
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 p-0">
              <SheetHeader className="border-b">
                <SheetTitle>Properties</SheetTitle>
              </SheetHeader>
              <ScrollArea className="h-[calc(100dvh-4.5rem)]">
                <SidePanels theme={theme} />
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {!compact && (
          <aside className="bg-card w-64 shrink-0 border-r">
            <PartPalette className="h-full" />
          </aside>
        )}

        <BuilderCanvas theme={theme} className="min-w-0 flex-1" />

        {!compact && (
          <aside className="bg-card w-72 shrink-0 overflow-hidden border-l xl:w-80">
            <ScrollArea className="h-full">
              <SidePanels theme={theme} />
            </ScrollArea>
          </aside>
        )}
      </div>

      <footer className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-1.5 text-[11px]">
        <span>Drag a pin to another pin to wire</span>
        <span>Drag empty space to select</span>
        <span>⌥ or middle-drag to pan · ⌘scroll to zoom</span>
        <span>R rotates · ⇧R the other way</span>
        <span>Arrows nudge · ⌘drag ignores the grid</span>
        <span>G groups · ⇧G ungroups</span>
        <span>Equation tab builds from a truth table or Σm</span>
        <span className="ml-auto">
          Building an assignment answer?{" "}
          <Link href="/solutions" className="text-foreground underline underline-offset-4">
            Worked solutions
          </Link>
        </span>
      </footer>
    </div>
  );
}

function SidePanels({ theme }: { theme: ReturnType<typeof useDiagramTheme> }) {
  // On an empty canvas the Block tab says "select a block", which is a dead end.
  // Open on Equation instead: it is the one panel that can do something useful
  // when there is nothing to select.
  const empty = useBuilderStore((s) => Object.keys(s.doc.instances).length === 0);
  return (
    <Tabs defaultValue={empty ? "build" : "block"} className="p-0">
      <TabsList className="w-full rounded-none border-b bg-transparent px-2">
        <TabsTrigger value="block" className="text-xs">
          <SlidersHorizontal className="size-3.5" />
          Block
        </TabsTrigger>
        <TabsTrigger value="build" className="text-xs">
          <Sparkles className="size-3.5" />
          Equation
        </TabsTrigger>
        <TabsTrigger value="style" className="text-xs">
          <Paintbrush className="size-3.5" />
          Style
        </TabsTrigger>
      </TabsList>
      <TabsContent value="block" className="mt-0">
        <Inspector />
      </TabsContent>
      <TabsContent value="build" className="mt-0">
        <SynthesisPanel theme={theme} />
      </TabsContent>
      <TabsContent value="style" className="mt-0 p-4">
        <StylePanel theme={theme} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * Shortcuts that must work wherever the focus is — except inside a text field,
 * where "G" means the letter G and ⌫ means delete a character.
 */
function useGlobalShortcuts(theme: DiagramTheme): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      const store = useBuilderStore.getState();
      const { doc, selection, selectedLink } = store;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const copy = duplicate(doc, selection);
        store.commit(copy.doc);
        store.select(copy.ids);
        return;
      }
      if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        store.select(Object.keys(doc.instances));
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selection.length === 0 && !selectedLink) return;
        e.preventDefault();
        store.commit(removeSelection(doc, selection, selectedLink ? [selectedLink] : []));
        store.clearSelection();
        return;
      }
      if (e.key.toLowerCase() === "r" && !meta) {
        if (selection.length === 0) return;
        e.preventDefault();
        store.commit(rotateInstances(doc, selection, e.shiftKey ? -90 : 90, theme));
        return;
      }
      // Nudge: one grid step, or one pixel with Shift. The last bit of
      // placement a mouse is bad at.
      const step = ARROWS[e.key];
      if (step && !meta) {
        if (selection.length === 0) return;
        e.preventDefault();
        const d = e.shiftKey ? 1 : GRID;
        store.commit(offsetInstances(doc, selection, step.x * d, step.y * d));
        return;
      }
      if (e.key.toLowerCase() === "g" && !meta) {
        e.preventDefault();
        if (e.shiftKey) {
          const only = selection[0];
          if (!only || !doc.instances[only]?.part.startsWith("custom:")) return;
          const result = ungroup(doc, only);
          if (!result.ok) return;
          store.commit(result.doc);
          store.select(result.ids);
        } else {
          if (selection.length === 0) return;
          const result = group(doc, selection, "My block");
          if (!result.ok) return;
          store.commit(result.doc);
          store.select([result.id]);
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [theme]);
}

const ARROWS: Readonly<Record<string, { x: number; y: number } | undefined>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
