"use client";

import { useState } from "react";
import { Boxes, Group, RotateCcw, RotateCw, Ungroup } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  group,
  offsetInstances,
  rotateInstances,
  setLink,
  setValues,
  ungroup,
} from "@/lib/diagram/editor/ops";
import { blockOf, rotationOf, toDiagram, type Instance } from "@/lib/diagram/editor/document";
import { getPart, partDefaults, type PartParam } from "@/lib/diagram/editor/parts";
import { colorSlots } from "@/lib/diagram/layout";
import { wireColorOf } from "@/lib/diagram/svg";
import { cn } from "@/lib/utils";
import { useBuilderStore } from "@/stores/builder-store";
import { useDiagramTheme } from "@/stores/diagram-store";

/**
 * The properties panel.
 *
 * This is where a parametric part earns its keep: a decoder placed with two
 * address lines becomes a 4-to-16 by changing a number, and the wires that
 * survive the change stay attached. It is also the only place that can warn you
 * when the change costs you some — narrowing a block really does delete pins,
 * and the wires on them go with them.
 */
export function Inspector() {
  const doc = useBuilderStore((s) => s.doc);
  const selection = useBuilderStore((s) => s.selection);
  const selectedLink = useBuilderStore((s) => s.selectedLink);
  const commit = useBuilderStore((s) => s.commit);
  const select = useBuilderStore((s) => s.select);

  if (selectedLink) return <LinkInspector id={selectedLink} />;

  if (selection.length > 1) {
    return (
      <MultiSelection
        count={selection.length}
        onGroup={(name) => {
          const result = group(doc, selection, name);
          if (!result.ok) {
            toast.error("Cannot group that", { description: result.reason });
            return;
          }
          commit(result.doc);
          select([result.id]);
          toast.success(`Made “${name}”`, {
            description: "It is in the palette now — place it as many times as you like.",
          });
        }}
      />
    );
  }

  const id = selection[0];
  const instance = id ? doc.instances[id] : undefined;
  if (!instance) {
    return (
      <p className="text-muted-foreground p-4 text-sm text-pretty">
        Select a block to change what it is. Select several to fold them into one
        reusable block.
      </p>
    );
  }

  const block = blockOf(doc, instance);
  const isCustom = instance.part.startsWith("custom:");
  const part = isCustom ? undefined : getPart(instance.part);
  const values = { ...(part ? partDefaults(part) : {}), ...instance.values };

  return (
    <div className="space-y-4 p-4">
      <header>
        <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
          {isCustom ? "Your block" : (part?.name ?? "Block")}
        </p>
        <h3 className="text-sm font-medium">{block?.title ?? instance.part}</h3>
        <p className="text-muted-foreground mt-0.5 text-[11px]">
          {block?.ports.length ?? 0} pins
        </p>
      </header>

      <Placement instance={instance} />

      {isCustom ? (
        <>
          <p className="text-muted-foreground text-xs text-pretty">
            This block was made by grouping. Taking it apart puts its contents back
            on the canvas and reconnects whatever was wired to it.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              const result = ungroup(doc, instance.id);
              if (!result.ok) {
                toast.error(result.reason);
                return;
              }
              commit(result.doc);
              select(result.ids);
            }}
          >
            <Ungroup />
            Ungroup
          </Button>
        </>
      ) : (
        <div className="space-y-3">
          {(part?.params ?? []).map((param) => (
            <ParamField
              key={param.key}
              param={param}
              value={values[param.key]}
              onChange={(value) => {
                const result = setValues(doc, instance.id, { [param.key]: value });
                commit(result.doc);
                if (result.removedLinks > 0) {
                  toast.warning(
                    `${result.removedLinks} wire${result.removedLinks === 1 ? "" : "s"} removed`,
                    { description: "Those pins no longer exist on this block. Undo to get them back." },
                  );
                }
              }}
            />
          ))}
          {(part?.params ?? []).length === 0 && (
            <p className="text-muted-foreground text-xs">This block has no settings.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Where the block is and which way it is facing.
 *
 * TYPED COORDINATES, not only a drag. Three things a mouse is bad at and this
 * is good at: putting two blocks on exactly the same line, spacing a row of
 * four evenly, and moving something by a known amount. It is the same document
 * field either way — the numbers here are the numbers the drag writes.
 */
function Placement({ instance }: { instance: Instance }) {
  const doc = useBuilderStore((s) => s.doc);
  const commit = useBuilderStore((s) => s.commit);
  const theme = useDiagramTheme();
  const rotation = rotationOf(instance);

  // `offsetInstances`, not `placeInstances`: the latter snaps to the grid, and
  // a typed number that silently becomes a different typed number is the field
  // refusing to do the one thing it exists for.
  const moveTo = (x: number, y: number) =>
    commit(offsetInstances(doc, [instance.id], x - instance.x, y - instance.y));

  const turn = (delta: number) =>
    commit(rotateInstances(doc, [instance.id], delta, theme));

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="block-x" className="text-xs">
            X
          </Label>
          <Input
            id="block-x"
            type="number"
            step={8}
            className="h-8 font-mono text-xs"
            value={instance.x}
            onChange={(e) => {
              const n = Number.parseFloat(e.target.value);
              if (Number.isFinite(n)) moveTo(n, instance.y);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="block-y" className="text-xs">
            Y
          </Label>
          <Input
            id="block-y"
            type="number"
            step={8}
            className="h-8 font-mono text-xs"
            value={instance.y}
            onChange={(e) => {
              const n = Number.parseFloat(e.target.value);
              if (Number.isFinite(n)) moveTo(instance.x, n);
            }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs flex-1">Rotation</span>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => turn(-90)}
          aria-label="Rotate anticlockwise"
        >
          <RotateCcw />
        </Button>
        <span className="text-muted-foreground w-9 text-center font-mono text-xs">
          {rotation}°
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => turn(90)}
          aria-label="Rotate clockwise"
        >
          <RotateCw />
        </Button>
      </div>
    </div>
  );
}

/**
 * One wire's colour.
 *
 * Automatic colouring — a hue per signal, shared by every branch of a fan-out —
 * is the right default and is wrong in exactly one situation, which is the one
 * that matters: when the reader has to be shown *this* wire. The carry chain,
 * the enable, the one line the paragraph underneath is about. So the automatic
 * choice is offered first and is where the wire starts, and the theme's own
 * palette is offered next, because a figure with one colour that came from
 * outside its palette looks like a mistake rather than an emphasis.
 */
function WireColor({ id }: { id: string }) {
  const doc = useBuilderStore((s) => s.doc);
  const commit = useBuilderStore((s) => s.commit);
  const theme = useDiagramTheme();
  const link = doc.links[id];
  if (!link) return null;

  const set = (color: string | undefined) => commit(setLink(doc, id, { color }));

  // What the theme would have chosen, so the "Automatic" chip shows the colour
  // it actually means rather than a grey placeholder.
  const slot = colorSlots(toDiagram(doc).links).get(`${link.from.block}.${link.from.port}`);
  const automatic = wireColorOf(slot ?? null, theme);
  const swatches = theme.wireColoring === "mono" ? [] : theme.palette;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Colour</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => set(undefined)}
          aria-label="Automatic colour"
          aria-pressed={link.color === undefined}
          title="Automatic — this signal's own colour"
          className={cn(
            "flex h-6 items-center gap-1 rounded border px-1.5 text-[10px]",
            link.color === undefined ? "border-foreground" : "border-border",
          )}
        >
          <span
            className="size-3 rounded-full border"
            style={{ backgroundColor: automatic }}
          />
          Auto
        </button>

        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => set(c)}
            aria-label={`Colour ${c}`}
            aria-pressed={link.color === c}
            title={c}
            className={cn(
              "size-6 rounded border-2",
              link.color === c ? "border-foreground" : "border-transparent",
            )}
            style={{ backgroundColor: c }}
          />
        ))}

        <input
          type="color"
          aria-label="Custom wire colour"
          title="Any other colour"
          value={link.color ?? automatic}
          onChange={(e) => set(e.target.value)}
          className="size-6 cursor-pointer rounded border bg-transparent p-0"
        />
      </div>
      {theme.wireColoring === "mono" && link.color === undefined && (
        <p className="text-muted-foreground text-[11px] text-pretty">
          The theme is drawing every wire in one colour. Pick one here to make this
          wire the exception, or switch to per-signal colouring in Style.
        </p>
      )}
    </div>
  );
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: PartParam;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  const current = value ?? param.initial;

  return (
    <div className="space-y-1.5">
      {param.kind !== "bool" && (
        <Label htmlFor={param.key} className="text-xs">
          {param.label}
        </Label>
      )}

      {param.kind === "bool" ? (
        <div className="flex items-center gap-3">
          <span className="flex-1 text-xs">{param.label}</span>
          <Switch
            checked={Boolean(current)}
            onCheckedChange={(v) => onChange(v)}
            aria-label={param.label}
          />
        </div>
      ) : param.kind === "choice" ? (
        <Select value={String(current)} onValueChange={onChange}>
          <SelectTrigger id={param.key} className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(param.choices ?? []).map((c) => (
              <SelectItem key={c.value} value={c.value} className="text-xs">
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : param.kind === "int" ? (
        <Input
          id={param.key}
          type="number"
          className="h-8 font-mono text-xs"
          value={String(current)}
          min={param.min}
          max={param.max}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            if (!Number.isFinite(n)) return;
            // Clamped here rather than at build time: a decoder with 40 address
            // lines would try to draw a trillion output pins and hang the tab.
            onChange(
              Math.min(param.max ?? Number.MAX_SAFE_INTEGER, Math.max(param.min ?? 0, n)),
            );
          }}
        />
      ) : (
        <Input
          id={param.key}
          className="h-8 font-mono text-xs"
          value={String(current)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {param.hint && (
        <p className="text-muted-foreground text-[11px] text-pretty">{param.hint}</p>
      )}
    </div>
  );
}

function MultiSelection({
  count,
  onGroup,
}: {
  count: number;
  onGroup: (name: string) => void;
}) {
  const [name, setName] = useState("My block");
  return (
    <div className="space-y-3 p-4">
      <header>
        <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
          Selection
        </p>
        <h3 className="text-sm font-medium">{count} blocks</h3>
      </header>

      <div className="space-y-1.5">
        <Label htmlFor="group-name" className="text-xs">
          Fold into one block, named
        </Label>
        <Input
          id="group-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 text-xs"
        />
      </div>

      <Button size="sm" className="w-full" onClick={() => onGroup(name.trim() || "My block")}>
        <Group />
        Group
      </Button>

      <Separator />

      <div className="text-muted-foreground space-y-1.5 text-[11px] text-pretty">
        <p className="flex items-start gap-1.5">
          <Boxes className="mt-0.5 size-3 shrink-0" />
          <span>
            The new block&apos;s pins come from the Input and Output tags inside the
            selection, plus any wire that crosses its boundary. It joins the palette,
            so a 4-bit adder you built once can be placed four times to make a 16-bit
            one.
          </span>
        </p>
      </div>
    </div>
  );
}

function LinkInspector({ id }: { id: string }) {
  const doc = useBuilderStore((s) => s.doc);
  const commit = useBuilderStore((s) => s.commit);
  const link = doc.links[id];
  if (!link) return null;

  return (
    <div className="space-y-3 p-4">
      <header>
        <p className="text-muted-foreground text-[11px] tracking-wide uppercase">Wire</p>
        <h3 className="font-mono text-xs">
          {link.from.block}.{link.from.port} → {link.to.block}.{link.to.port}
        </h3>
      </header>

      <div className="space-y-1.5">
        <Label htmlFor="wire-label" className="text-xs">
          Label on the wire
        </Label>
        <Input
          id="wire-label"
          value={link.label ?? ""}
          placeholder="none"
          className="h-8 font-mono text-xs"
          onChange={(e) => commit(setLink(doc, id, { label: e.target.value }))}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wire-width" className="text-xs">
          Bus width
        </Label>
        <Input
          id="wire-width"
          type="number"
          min={1}
          max={64}
          value={link.width ?? 1}
          className="h-8 font-mono text-xs"
          onChange={(e) => {
            const n = Math.max(1, Math.min(64, Number.parseInt(e.target.value, 10) || 1));
            commit(setLink(doc, id, { width: n }));
          }}
        />
        <p className="text-muted-foreground text-[11px] text-pretty">
          Above 1 the wire is drawn thick, with a slash and the width — the notation
          that turns sixteen address lines into one readable line.
        </p>
      </div>

      <WireColor id={id} />

      <div className="flex items-center gap-3">
        <span className="flex-1 text-xs">Dashed</span>
        <Switch
          checked={link.style === "dashed"}
          onCheckedChange={(v) => commit(setLink(doc, id, { style: v ? "dashed" : "solid" }))}
        />
      </div>

      <p className="text-muted-foreground text-[11px]">
        Press Delete to remove this wire.
      </p>
    </div>
  );
}
