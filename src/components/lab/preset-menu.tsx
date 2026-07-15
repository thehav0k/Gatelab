"use client";

import { toast } from "sonner";
import { Blocks } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useCircuitStore } from "@/stores/circuit-store";
import { useSpecStore } from "@/stores/spec-store";
import { PRESETS, buildPreset, type Preset } from "@/lib/simulation/presets";
import { composePreset, type CompositeSpec } from "@/lib/simulation/compose";
import { COMPOSITES } from "@/lib/simulation/composites";

export function PresetMenu() {
  const load = useCircuitStore((s) => s.load);
  const clearSpec = useSpecStore((s) => s.clear);

  const openPreset = (preset: Preset) => {
    load(buildPreset(preset));
    // A preset is not the function the theory workspace was checking, so drop
    // the old spec rather than verify the new board against a stale one.
    clearSpec();
    toast.success(preset.name, {
      description: preset.note ?? preset.description,
      duration: preset.note ? 9000 : 4000,
    });
  };

  const openComposite = (spec: CompositeSpec) => {
    load(composePreset(spec));
    clearSpec();
    toast.success(spec.name, {
      description: spec.note ?? spec.description,
      duration: spec.note ? 10000 : 4000,
    });
  };

  const lessons = PRESETS.filter((p) => p.note);
  const blocks = PRESETS.filter((p) => !p.note);

  // The composites split into two lessons: how one block is built from smaller
  // ones, and how the same block scales up into something large.
  const built = COMPOSITES.filter((c) => c.id.includes("-from-"));
  const scaled = COMPOSITES.filter((c) => !c.id.includes("-from-"));

  const Item = ({
    name,
    desc,
    onClick,
  }: {
    name: string;
    desc: string;
    onClick: () => void;
  }) => (
    <DropdownMenuItem onClick={onClick} className="flex-col items-start">
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground text-xs">{desc}</span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Blocks />
          <span className="hidden sm:inline">Presets</span>
          <span className="sr-only sm:hidden">Presets</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-0">
        <ScrollArea className="max-h-[70vh]">
          <div className="p-1">
            <DropdownMenuLabel>Building blocks</DropdownMenuLabel>
            {blocks.map((p) => (
              <Item key={p.id} name={p.name} desc={p.description} onClick={() => openPreset(p)} />
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Built from smaller blocks</DropdownMenuLabel>
            {built.map((c) => (
              <Item key={c.id} name={c.name} desc={c.description} onClick={() => openComposite(c)} />
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Large circuits</DropdownMenuLabel>
            {scaled.map((c) => (
              <Item key={c.id} name={c.name} desc={c.description} onClick={() => openComposite(c)} />
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Minimal is not hazard-free</DropdownMenuLabel>
            {lessons.map((p) => (
              <Item key={p.id} name={p.name} desc={p.description} onClick={() => openPreset(p)} />
            ))}
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
