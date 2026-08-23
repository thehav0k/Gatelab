"use client";

import { useState } from "react";
import { Check, Copy, Download, FileImage, FileCode2, Printer, Sigma } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DiagramTheme } from "@/lib/diagram/theme";

/**
 * Getting the figure OUT of the app, which is what most people came for.
 *
 * SVG is offered first and deliberately. It is a vector, it stays sharp at any
 * size, Word and Google Docs both take it, and it can be edited afterwards —
 * which matters, because a student often wants to add an annotation the tool
 * did not think of. PNG exists because some submission portals still refuse
 * anything else.
 *
 * THE RASTERISER, AND THE ONE THING THAT BREAKS IT. An SVG drawn into a canvas
 * via an <img> runs in a sandbox with NO access to the page: no stylesheet, no
 * CSS custom properties, no web fonts. That is exactly why `svg.ts` writes plain
 * hex colours and names only system font stacks. If either rule were broken, the
 * PNG would come out with invisible shapes and no error anywhere — the failure
 * would first be seen by whoever opened the file.
 *
 * The canvas is never tainted: the SVG is inlined as a data URI, no external
 * reference is ever fetched, so `toBlob` is allowed.
 */

/**
 * Percent-encoded, not base64.
 *
 * The usual `btoa(svg)` throws outright on any character above U+00FF, and these
 * diagrams are full of them — '×', '⊙', '≤', the en dashes in "Y0–Y3". Encoding
 * the UTF-8 bytes by hand to feed btoa is more code and produces a longer URI
 * than percent-encoding does, so there is no reason to.
 */
const encodeSvg = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next frame; revoking synchronously races the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function rasterize(
  svg: string,
  scale: number,
  background: string,
): Promise<Blob> {
  const size = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const w = Number(size?.[1] ?? 800);
  const h = Number(size?.[2] ?? 600);

  const image = new Image();
  image.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The browser could not render the SVG."));
    image.src = encodeSvg(svg);
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser has no 2D canvas.");

  // A theme with a transparent background stays transparent — that is the point
  // of choosing it — so nothing is painted underneath.
  if (background !== "none") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the PNG."))),
      "image/png",
    );
  });
}

export function ExportMenu({
  svg,
  name,
  theme,
  latex,
}: {
  svg: string;
  name: string;
  theme: DiagramTheme;
  /**
   * The figure as a TikZ picture, built on demand.
   *
   * A callback rather than a string because generating it walks the whole
   * placement, and almost nobody opens this menu to click that item — there is
   * no reason to pay for it on every render of every diagram on the page.
   */
  latex?: (form: "standalone" | "figure") => string;
}) {
  const [copied, setCopied] = useState(false);

  const fail = (e: unknown) =>
    toast.error("Export failed", {
      description: e instanceof Error ? e.message : String(e),
    });

  const png = async (scale: number) => {
    try {
      const blob = await rasterize(svg, scale, theme.background);
      saveBlob(blob, `${name}@${scale}x.png`);
      toast.success(`Saved ${name}@${scale}x.png`);
    } catch (e) {
      fail(e);
    }
  };

  const copySvg = async () => {
    try {
      await navigator.clipboard.writeText(svg);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("SVG copied — paste it into a document or an editor");
    } catch (e) {
      fail(e);
    }
  };

  const copyPng = async () => {
    try {
      const blob = await rasterize(svg, 2, theme.background);
      // ClipboardItem is not in every browser, and Firefox refuses image writes.
      // Say so plainly rather than failing silently.
      if (typeof ClipboardItem === "undefined") {
        throw new Error("This browser cannot put an image on the clipboard. Download it instead.");
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("Image copied to the clipboard");
    } catch (e) {
      fail(e);
    }
  };

  const print = () => {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      toast.error("The browser blocked the print window", {
        description: "Allow pop-ups for this site, or download the SVG and print that.",
      });
      return;
    }
    win.document.write(
      `<!doctype html><title>${name}</title><style>@page{margin:12mm}body{margin:0}svg{width:100%;height:auto}</style>${svg}`,
    );
    win.document.close();
    win.focus();
    // Give the browser a beat to lay the SVG out before the dialog steals focus.
    setTimeout(() => win.print(), 250);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs">
          <Download className="size-3.5" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs">Vector</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() =>
            saveBlob(new Blob([svg], { type: "image/svg+xml" }), `${name}.svg`)
          }
        >
          <FileCode2 />
          Download SVG
          <span className="text-muted-foreground ml-auto text-[10px]">sharp at any size</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copySvg}>
          {copied ? <Check /> : <Copy />}
          Copy SVG markup
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Image</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => png(1)}>
          <FileImage />
          PNG — 1×
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => png(2)}>
          <FileImage />
          PNG — 2× <span className="text-muted-foreground ml-auto text-[10px]">retina</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => png(4)}>
          <FileImage />
          PNG — 4× <span className="text-muted-foreground ml-auto text-[10px]">print</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copyPng}>
          <Copy />
          Copy image
        </DropdownMenuItem>

        {latex && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">LaTeX</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() =>
                saveBlob(
                  new Blob([latex("standalone")], { type: "text/x-tex" }),
                  `${name}.tex`,
                )
              }
            >
              <Sigma />
              Download .tex
              <span className="text-muted-foreground ml-auto text-[10px]">standalone</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(latex("figure"));
                  toast.success("TikZ copied", {
                    description: "Paste it into your document. It needs \\usepackage{tikz} and nothing else.",
                  });
                } catch (e) {
                  fail(e);
                }
              }}
            >
              <Copy />
              Copy TikZ figure
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={print}>
          <Printer />
          Print this figure
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
