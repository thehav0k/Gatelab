"use client";

import { Palette, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { THEMES, TONE_LABELS, type DiagramTheme } from "@/lib/diagram/theme";
import type { BlockTone } from "@/lib/diagram/types";
import {
  AUTO,
  useDiagramStore,
  useDiagramThemeName,
  useThemeIsCustomised,
} from "@/stores/diagram-store";
import { cn } from "@/lib/utils";

/**
 * Every colour and stroke the renderer can emit, exposed.
 *
 * The panel writes a PATCH into the store, never a whole theme. So "start from
 * Blueprint but make the wires white" survives a switch to Print and back, and a
 * preset that is improved in a later release still reaches somebody who had
 * changed one colour in it.
 *
 * Native `<input type="color">` on purpose. It is the OS colour picker — with
 * eyedropper, recent swatches and the palette the user already has — for zero
 * bundle weight, and every attempt to reimplement one ends up worse.
 */
export function StylePanel({ theme }: { theme: DiagramTheme }) {
  const themeName = useDiagramThemeName();
  const setThemeName = useDiagramStore((s) => s.setThemeName);
  const patch = useDiagramStore((s) => s.patchTheme);
  const reset = useDiagramStore((s) => s.resetTheme);
  const dirty = useThemeIsCustomised();

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Preset</Label>
          <Select value={themeName} onValueChange={setThemeName}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Match the app (light / dark)</SelectItem>
              {THEMES.map((t) => (
                <SelectItem key={t.name} value={t.name}>
                  <span className="flex items-center gap-2">
                    <span
                      className="size-3 shrink-0 rounded-sm border"
                      style={{
                        backgroundColor: t.background === "none" ? "transparent" : t.background,
                        borderColor: t.frameColor,
                      }}
                    />
                    {t.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={reset}
          disabled={!dirty}
          title="Discard your changes and go back to the preset"
        >
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      </div>

      <Separator />

      {/* --- page ------------------------------------------------------- */}
      <Group title="Page">
        <ColorRow
          label="Background"
          value={theme.background}
          onChange={(background) => patch({ background })}
          allowNone
          onNone={() => patch({ background: "none" })}
          noneLabel="Transparent"
        />
        <Row label="Grid">
          <ToggleGroup
            type="single"
            size="sm"
            value={theme.grid}
            onValueChange={(v) => v && patch({ grid: v as DiagramTheme["grid"] })}
            className="justify-start"
          >
            <ToggleGroupItem value="none" className="px-2.5 text-xs">
              None
            </ToggleGroupItem>
            <ToggleGroupItem value="dots" className="px-2.5 text-xs">
              Dots
            </ToggleGroupItem>
            <ToggleGroupItem value="lines" className="px-2.5 text-xs">
              Lines
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
        {theme.grid !== "none" && (
          <ColorRow
            label="Grid colour"
            value={theme.gridColor}
            onChange={(gridColor) => patch({ gridColor })}
          />
        )}
        <SliderRow
          label="Margin"
          value={theme.padding}
          min={0}
          max={80}
          onChange={(padding) => patch({ padding })}
        />
        <SwitchRow
          label="Border frame"
          checked={theme.showFrame}
          onChange={(showFrame) => patch({ showFrame })}
        />
      </Group>

      <Separator />

      {/* --- wires ------------------------------------------------------ */}
      <Group title="Wiring">
        <Row label="Colouring">
          <ToggleGroup
            type="single"
            size="sm"
            value={theme.wireColoring}
            onValueChange={(v) =>
              v && patch({ wireColoring: v as DiagramTheme["wireColoring"] })
            }
            className="justify-start"
          >
            <ToggleGroupItem value="mono" className="px-2.5 text-xs">
              One colour
            </ToggleGroupItem>
            <ToggleGroupItem value="source" className="px-2.5 text-xs">
              Per signal
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <p className="text-muted-foreground -mt-1 text-[11px] text-pretty">
          Per-signal colouring gives every net its own hue, and every branch of one
          fan-out the same one — which is why real jumper wire is multicoloured, and
          for the same reason: so a connection can be traced.
        </p>
        {theme.wireColoring === "mono" && (
          <ColorRow
            label="Wire colour"
            value={theme.wireColor}
            onChange={(wireColor) => patch({ wireColor })}
          />
        )}
        <ColorRow
          label="Bus colour"
          value={theme.busColor}
          onChange={(busColor) => patch({ busColor })}
        />
        <SliderRow
          label="Wire width"
          value={theme.wireWidth}
          min={0.5}
          max={4}
          step={0.1}
          onChange={(wireWidth) => patch({ wireWidth })}
        />
        <SliderRow
          label="Bus width"
          value={theme.busWidth}
          min={1}
          max={8}
          step={0.5}
          onChange={(busWidth) => patch({ busWidth })}
        />
        <SliderRow
          label="Corner rounding"
          value={theme.cornerRadius}
          min={0}
          max={12}
          onChange={(cornerRadius) => patch({ cornerRadius })}
        />
        <SwitchRow
          label="Arrowheads"
          checked={theme.showArrows}
          onChange={(showArrows) => patch({ showArrows })}
        />
        <SwitchRow
          label="Junction dots"
          checked={theme.showJunctions}
          onChange={(showJunctions) => patch({ showJunctions })}
        />
        {theme.wireColoring !== "mono" && (
          <PaletteRow
            palette={theme.palette}
            onChange={(palette) => patch({ palette })}
          />
        )}
      </Group>

      <Separator />

      {/* --- blocks ----------------------------------------------------- */}
      <Group title="Blocks">
        <SliderRow
          label="Corner radius"
          value={theme.blockRadius}
          min={0}
          max={16}
          onChange={(blockRadius) => patch({ blockRadius })}
        />
        <SliderRow
          label="Outline width"
          value={theme.blockStrokeWidth}
          min={0.5}
          max={4}
          step={0.1}
          onChange={(blockStrokeWidth) => patch({ blockStrokeWidth })}
        />
        <SwitchRow
          label="Drop shadow"
          checked={theme.blockShadow}
          onChange={(blockShadow) => patch({ blockShadow })}
        />
        <SwitchRow
          label="Pin labels"
          checked={theme.showPortLabels}
          onChange={(showPortLabels) => patch({ showPortLabels })}
        />
        <SwitchRow
          label="Block subtitles"
          checked={theme.showSubtitles}
          onChange={(showSubtitles) => patch({ showSubtitles })}
        />

        <Accordion type="single" collapsible>
          <AccordionItem value="tones" className="border-b-0">
            <AccordionTrigger className="py-2 text-xs">
              <span className="flex items-center gap-2">
                <Palette className="size-3.5" />
                Colour by block type
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-1">
              <p className="text-muted-foreground text-[11px] text-pretty">
                Each category is coloured as a group, so a decoder is never mistaken
                for a register.
              </p>
              {(Object.keys(TONE_LABELS) as BlockTone[])
                .filter((t) => t !== "note")
                .map((toneKey) => (
                  <div key={toneKey} className="flex items-center gap-2">
                    <span className="flex-1 text-xs">{TONE_LABELS[toneKey]}</span>
                    <Swatch
                      title="Fill"
                      value={theme.tones[toneKey].fill}
                      onChange={(fill) => patch({ tones: { [toneKey]: { fill } } })}
                    />
                    <Swatch
                      title="Outline"
                      value={theme.tones[toneKey].stroke}
                      onChange={(stroke) => patch({ tones: { [toneKey]: { stroke } } })}
                    />
                    <Swatch
                      title="Text"
                      value={theme.tones[toneKey].text}
                      onChange={(text) => patch({ tones: { [toneKey]: { text } } })}
                    />
                  </div>
                ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Group>

      <Separator />

      {/* --- type ------------------------------------------------------- */}
      <Group title="Text">
        <ColorRow
          label="Text"
          value={theme.textColor}
          onChange={(textColor) => patch({ textColor })}
        />
        <ColorRow
          label="Secondary text"
          value={theme.mutedTextColor}
          onChange={(mutedTextColor) => patch({ mutedTextColor })}
        />
        <SliderRow
          label="Title size"
          value={theme.titleSize}
          min={8}
          max={24}
          onChange={(titleSize) => patch({ titleSize })}
        />
        <SliderRow
          label="Pin label size"
          value={theme.portLabelSize}
          min={6}
          max={16}
          onChange={(portLabelSize) => patch({ portLabelSize })}
        />
        <SwitchRow
          label="Figure title"
          checked={theme.showTitle}
          onChange={(showTitle) => patch({ showTitle })}
        />
        <SwitchRow
          label="Caption and notes"
          checked={theme.showCaption}
          onChange={(showCaption) => patch({ showCaption })}
        />
      </Group>
    </div>
  );
}

// --- small pieces -----------------------------------------------------------

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h4 className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {title}
      </h4>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-xs">{label}</span>
      {children}
    </div>
  );
}

/** Only `#rrggbb` reaches `<input type="color">`; `none` and `#rrggbbaa` do not. */
const asHex6 = (value: string): string =>
  /^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{8}$/i.test(value) ? value.slice(0, 7) : "#ffffff";

function Swatch({
  value,
  onChange,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  title: string;
}) {
  return (
    <label className="relative block size-6 shrink-0" title={title}>
      <span
        className="border-border block size-6 rounded border"
        style={{ backgroundColor: value === "none" ? "transparent" : value }}
      />
      <input
        type="color"
        value={asHex6(value)}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        aria-label={title}
      />
    </label>
  );
}

function ColorRow({
  label,
  value,
  onChange,
  allowNone,
  onNone,
  noneLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allowNone?: boolean;
  onNone?: () => void;
  noneLabel?: string;
}) {
  return (
    <Row label={label}>
      {allowNone && (
        <Button
          variant={value === "none" ? "secondary" : "outline"}
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => (value === "none" ? onChange("#ffffff") : onNone?.())}
        >
          {noneLabel ?? "None"}
        </Button>
      )}
      <Swatch value={value} onChange={onChange} title={label} />
    </Row>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label}>
      <Switch checked={checked} onCheckedChange={onChange} />
    </Row>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-primary h-1.5 w-28 cursor-pointer"
        aria-label={label}
      />
      <span className="text-muted-foreground w-8 text-right font-mono text-[11px] tabular-nums">
        {Math.round(value * 10) / 10}
      </span>
    </Row>
  );
}

function PaletteRow({
  palette,
  onChange,
}: {
  palette: readonly string[];
  onChange: (p: string[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs">Signal palette</span>
      <div className={cn("flex flex-wrap gap-1.5")}>
        {palette.map((c, i) => (
          <Swatch
            key={i}
            value={c}
            title={`Colour ${i + 1}`}
            onChange={(v) => onChange(palette.map((old, k) => (k === i ? v : old)))}
          />
        ))}
      </div>
    </div>
  );
}
