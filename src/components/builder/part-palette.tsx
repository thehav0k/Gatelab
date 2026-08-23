"use client";

import { useState } from "react";
import { Boxes, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  PARTS,
  type PartDefinition,
} from "@/lib/diagram/editor/parts";
import { addFromPalette, deleteCustomPart } from "@/lib/diagram/editor/ops";
import { useBuilderStore } from "@/stores/builder-store";
import { cn } from "@/lib/utils";

/**
 * The parts list.
 *
 * Two ways to place, on purpose. DRAG puts the block exactly where you want it
 * and is what the tool is for; CLICK drops it in the open and is what you use
 * when the canvas is scrolled somewhere else, on a touch screen, or when
 * dragging thirty small gates would be tedious. Offering only drag makes the
 * palette unusable on a tablet; offering only click makes placement a chore.
 *
 * The user's own grouped blocks appear at the bottom, in the same list as the
 * built-in ones — because to the person building a 16-bit adder out of four
 * 4-bit ones, their block IS a part.
 */
export function PartPalette({ className }: { className?: string }) {
  const doc = useBuilderStore((s) => s.doc);
  const commit = useBuilderStore((s) => s.commit);
  const select = useBuilderStore((s) => s.select);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const matches = (p: PartDefinition) =>
    q === "" ||
    p.name.toLowerCase().includes(q) ||
    p.summary.toLowerCase().includes(q) ||
    p.id.includes(q);

  const drop = (partId: string) => {
    // Somewhere clear of what is already there, so a click never lands a block
    // exactly on top of another one.
    const used = Object.values(doc.instances);
    const y = used.length === 0 ? 60 : Math.max(...used.map((i) => i.y)) + 120;
    const added = addFromPalette(doc, partId, 80, y);
    if (!added) return;
    commit(added.doc);
    select([added.id]);
  };

  const customs = Object.values(doc.customParts);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="relative p-3 pb-2">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-6 size-3.5 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a block"
          className="h-9 pl-8 text-sm"
          aria-label="Search blocks"
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3 pt-1">
          {CATEGORY_ORDER.map((category) => {
            const items = PARTS.filter((p) => p.category === category && matches(p));
            if (items.length === 0) return null;
            return (
              <section key={category}>
                <h3 className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">
                  {CATEGORY_LABELS[category]}
                </h3>
                <ul className="space-y-1">
                  {items.map((part) => (
                    <li key={part.id}>
                      <PaletteItem
                        id={part.id}
                        name={part.name}
                        summary={part.summary}
                        onPlace={() => drop(part.id)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {customs.length > 0 && (
            <section>
              <h3 className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase">
                <Boxes className="size-3" />
                Your blocks
              </h3>
              <ul className="space-y-1">
                {customs.map((custom) => (
                  <li key={custom.id} className="group/custom relative">
                    <PaletteItem
                      id={`custom:${custom.id}`}
                      name={custom.name}
                      summary={`${custom.ports.length} pin${custom.ports.length === 1 ? "" : "s"} · ${custom.subtitle ?? "grouped"}`}
                      onPlace={() => drop(`custom:${custom.id}`)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-1 right-1 size-6 opacity-0 group-hover/custom:opacity-100"
                      aria-label={`Delete ${custom.name}`}
                      onClick={() => {
                        const result = deleteCustomPart(doc, custom.id);
                        if (result.ok) commit(result.doc);
                        else toast.error(result.reason);
                      }}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function PaletteItem({
  id,
  name,
  summary,
  onPlace,
}: {
  id: string;
  name: string;
  summary: string;
  onPlace: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/gatelab-part", id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onPlace}
      className="hover:bg-accent/60 w-full cursor-grab rounded-md border px-2.5 py-1.5 text-left transition-colors active:cursor-grabbing"
    >
      <p className="text-sm font-medium">{name}</p>
      <p className="text-muted-foreground text-[11px] leading-snug text-pretty">
        {summary}
      </p>
    </button>
  );
}
