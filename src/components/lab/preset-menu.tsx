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
import { Button } from "@/components/ui/button";
import { useCircuitStore } from "@/stores/circuit-store";
import { useSpecStore } from "@/stores/spec-store";
import { PRESETS, buildPreset, type Preset } from "@/lib/simulation/presets";

export function PresetMenu() {
  const load = useCircuitStore((s) => s.load);
  const clearSpec = useSpecStore((s) => s.clear);

  const open = (preset: Preset) => {
    load(buildPreset(preset));
    // A preset is not the function the theory workspace was checking, so drop
    // the old spec rather than verify the new board against a stale one.
    clearSpec();
    toast.success(preset.name, {
      description: preset.note ?? preset.description,
      duration: preset.note ? 9000 : 4000,
    });
  };

  const lessons = PRESETS.filter((p) => p.note);
  const blocks = PRESETS.filter((p) => !p.note);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Blocks /> Presets
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Building blocks</DropdownMenuLabel>
        {blocks.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => open(p)} className="flex-col items-start">
            <span className="font-medium">{p.name}</span>
            <span className="text-muted-foreground text-xs">{p.description}</span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Minimal is not hazard-free</DropdownMenuLabel>
        {lessons.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => open(p)} className="flex-col items-start">
            <span className="font-medium">{p.name}</span>
            <span className="text-muted-foreground text-xs">{p.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
