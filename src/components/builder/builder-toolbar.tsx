"use client";

import { useRef } from "react";
import {
  Copy,
  FileDown,
  FilePlus2,
  FileUp,
  Group,
  LayoutGrid,
  Redo2,
  Trash2,
  Undo2,
  Ungroup,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ExportMenu } from "@/components/diagrams/export-menu";
import { layout } from "@/lib/diagram/layout";
import { renderTikz } from "@/lib/diagram/latex";
import { renderSvg } from "@/lib/diagram/svg";
import type { DiagramTheme } from "@/lib/diagram/theme";
import {
  deserialize,
  serialize,
  toDiagram,
  type EditorDocument,
} from "@/lib/diagram/editor/document";
import {
  clearRotations,
  duplicate,
  group,
  placeInstances,
  removeSelection,
  ungroup,
} from "@/lib/diagram/editor/ops";
import { placeDocument } from "@/lib/diagram/editor/place";
import { TEMPLATES } from "@/lib/diagram/editor/templates";
import { useBuilderStore } from "@/stores/builder-store";

/**
 * The command bar.
 *
 * AUTO-ARRANGE is the one worth pointing at. It is not a second layout engine —
 * it runs the SAME layered placement the problem catalogue uses, then writes the
 * coordinates it produced back into the document as ordinary positions. So the
 * result is fully editable afterwards, and there is still only one piece of code
 * that knows how to lay a diagram out.
 */
export function BuilderToolbar({ theme }: { theme: DiagramTheme }) {
  const doc = useBuilderStore((s) => s.doc);
  const selection = useBuilderStore((s) => s.selection);
  const selectedLink = useBuilderStore((s) => s.selectedLink);
  const commit = useBuilderStore((s) => s.commit);
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const canUndo = useBuilderStore((s) => s.past.length > 0);
  const canRedo = useBuilderStore((s) => s.future.length > 0);
  const select = useBuilderStore((s) => s.select);
  const clearSelection = useBuilderStore((s) => s.clearSelection);
  const replaceDocument = useBuilderStore((s) => s.replaceDocument);
  const rename = useBuilderStore((s) => s.rename);

  const fileInput = useRef<HTMLInputElement | null>(null);
  const empty = Object.keys(doc.instances).length === 0;

  const soleCustom =
    selection.length === 1 && doc.instances[selection[0] as string]?.part.startsWith("custom:")
      ? (selection[0] as string)
      : null;

  const arrange = () => {
    if (empty) return;
    const tidy = layout(toDiagram(doc), theme);
    const positions = new Map(tidy.blocks.map((b) => [b.block.id, { x: b.x, y: b.y }]));
    // Standing the blocks up is part of arranging, not a side effect of it:
    // `layout()` sizes a block by its upright footprint, so a turned one left
    // turned would be laid out into an overlap.
    const turned = Object.values(doc.instances).some((i) => i.rotation !== undefined);
    commit(placeInstances(clearRotations(doc), positions));
    toast.success("Arranged", {
      description: turned
        ? "Signals flow left to right, and everything is upright again. Undo if you meant to keep a block turned."
        : "Signals flow left to right. Everything is still editable.",
    });
  };

  const doGroup = () => {
    const result = group(doc, selection, "My block");
    if (!result.ok) {
      toast.error("Cannot group that", { description: result.reason });
      return;
    }
    commit(result.doc);
    select([result.id]);
  };

  const doUngroup = () => {
    if (!soleCustom) return;
    const result = ungroup(doc, soleCustom);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    commit(result.doc);
    select(result.ids);
  };

  const load = (next: EditorDocument, what: string) => {
    replaceDocument(next);
    toast.success(what);
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    const parsed = deserialize(text);
    if ("error" in parsed) {
      toast.error("Could not open that file", { description: parsed.error });
      return;
    }
    load(parsed.doc, `Opened “${parsed.doc.title}”`);
  };

  // The export is a FIGURE — cropped to its contents, with the title and the
  // margin a document wants. The canvas is a workspace and is framed differently
  // on purpose; the blocks and wires themselves are identical bytes.
  const figure = placeDocument(doc, theme, { tight: true });
  const exportSvg = renderSvg(figure, theme);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
      <Input
        value={doc.title}
        onChange={(e) => rename(e.target.value)}
        aria-label="Diagram title"
        className="h-8 w-48 text-sm font-medium"
      />

      <Separator orientation="vertical" className="mx-1 h-6" />

      <IconButton label="Undo (⌘Z)" onClick={undo} disabled={!canUndo}>
        <Undo2 />
      </IconButton>
      <IconButton label="Redo (⇧⌘Z)" onClick={redo} disabled={!canRedo}>
        <Redo2 />
      </IconButton>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <IconButton
        label="Duplicate (⌘D)"
        disabled={selection.length === 0}
        onClick={() => {
          const copy = duplicate(doc, selection);
          commit(copy.doc);
          select(copy.ids);
        }}
      >
        <Copy />
      </IconButton>
      <IconButton
        label="Group into one block (G)"
        disabled={selection.length === 0}
        onClick={doGroup}
      >
        <Group />
      </IconButton>
      <IconButton label="Ungroup (⇧G)" disabled={!soleCustom} onClick={doUngroup}>
        <Ungroup />
      </IconButton>
      <IconButton
        label="Delete (⌫)"
        disabled={selection.length === 0 && !selectedLink}
        onClick={() => {
          commit(removeSelection(doc, selection, selectedLink ? [selectedLink] : []));
          clearSelection();
        }}
      >
        <Trash2 />
      </IconButton>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={arrange} disabled={empty}>
        <LayoutGrid className="size-3.5" />
        Arrange
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
            <Wand2 className="size-3.5" />
            Start from
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-xs">
            Replaces the canvas — undo brings it back
          </DropdownMenuLabel>
          {TEMPLATES.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => load(t.build(), `Loaded “${t.name}”`)}
              className="flex-col items-start gap-0.5"
            >
              <span className="text-sm">{t.name}</span>
              <span className="text-muted-foreground text-[11px] text-pretty">
                {t.summary}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
              <FileDown className="size-3.5" />
              File
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem
              onClick={() => {
                useBuilderStore.getState().reset();
                toast.success("New canvas");
              }}
            >
              <FilePlus2 />
              New
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                const blob = new Blob([serialize(doc)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${doc.title.replace(/[^\w-]+/g, "-").toLowerCase() || "circuit"}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              <FileDown />
              Save as JSON
              <span className="text-muted-foreground ml-auto text-[10px]">editable</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInput.current?.click()}>
              <FileUp />
              Open a JSON file
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ExportMenu
          svg={exportSvg}
          name={doc.title.replace(/[^\w-]+/g, "-").toLowerCase() || "circuit"}
          theme={theme}
          latex={(form) =>
            renderTikz(figure, theme, {
              standalone: form === "standalone",
              background: form === "standalone" && theme.background !== "none",
            })
          }
        />
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
          // Reset, or picking the same file twice in a row does nothing.
          e.target.value = "";
        }}
      />
    </div>
  );
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
