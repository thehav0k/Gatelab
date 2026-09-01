import { asRotation, type Block, type BlockTone, type Diagram, type Endpoint, type Link, type Port, type Rotation } from "../types";
import { getPart, partDefaults, type PartValues } from "./parts";

/**
 * The editor's document.
 *
 * WHAT IS STORED IS THE RECIPE, NOT THE RESULT. An instance holds
 * `{ part: "decoder", values: { addr: 3, enable: true }, x, y }` and the block is
 * REBUILT from the parts registry whenever it is drawn. Storing the built block
 * instead would freeze it: changing "3 address lines" to "4" on a placed decoder
 * would be impossible, and every saved file would carry a snapshot of whatever
 * the catalogue happened to look like on the day it was made.
 *
 * The document is plain JSON — no class instances, no functions, no Maps — so it
 * round-trips through `localStorage` and through a downloaded `.json` file
 * without a custom serializer.
 */

export interface Instance {
  readonly id: string;
  /** A registry part id, or `custom:<id>` for one the user built. */
  readonly part: string;
  readonly values: PartValues;
  readonly x: number;
  readonly y: number;
  /**
   * Clockwise turn in degrees. Absent means upright, so every document written
   * before rotation existed still loads and still means what it said.
   */
  readonly rotation?: Rotation;
}

/** An instance's turn, defaulted and sanitised. Read it through here, always. */
export const rotationOf = (instance: Instance): Rotation =>
  asRotation(instance.rotation ?? 0);

export interface EditorLink {
  readonly id: string;
  readonly from: Endpoint;
  readonly to: Endpoint;
  readonly width?: number;
  readonly label?: string;
  readonly style?: "solid" | "dashed";
  /** An explicit `#rrggbb`, overriding the theme's choice for this one wire. */
  readonly color?: string;
}

/**
 * A block the user made by grouping a selection.
 *
 * This is what turns a drawing tool into a design tool. A 4-bit adder built from
 * four full adders becomes ONE block that can be placed four times to make a
 * 16-bit adder — which is how every real digital system is actually built, and
 * the thing a flat canvas can never express.
 *
 * `body` keeps the original sub-document so the block can be taken apart again,
 * and `boundary` records which inner pin each of its outer pins came from, so
 * ungrouping can reconnect the outside world to the right places.
 */
export interface CustomPart {
  readonly id: string;
  readonly name: string;
  readonly subtitle?: string;
  readonly tone: BlockTone;
  readonly ports: readonly Port[];
  readonly body: EditorDocument;
  /** Outer port id -> the inner endpoint it stands for. */
  readonly boundary: Readonly<Record<string, Endpoint>>;
}

export interface EditorDocument {
  readonly title: string;
  readonly instances: Readonly<Record<string, Instance>>;
  readonly links: Readonly<Record<string, EditorLink>>;
  readonly customParts: Readonly<Record<string, CustomPart>>;
  /** Monotonic id counter. Ids are never reused, so undo cannot resurrect a collision. */
  readonly seq: number;
}

export const emptyDocument = (title = "Untitled circuit"): EditorDocument => ({
  title,
  instances: {},
  links: {},
  customParts: {},
  seq: 0,
});

// --- materialising ----------------------------------------------------------

/** Build the drawable block for one instance, or null if its part is unknown. */
export function blockOf(doc: EditorDocument, instance: Instance): Block | null {
  if (instance.part.startsWith("custom:")) {
    const custom = doc.customParts[instance.part.slice(7)];
    if (!custom) return null;
    return {
      id: instance.id,
      kind: "box",
      title: custom.name,
      ...(custom.subtitle ? { subtitle: custom.subtitle } : {}),
      tone: custom.tone,
      ports: custom.ports,
    };
  }
  const part = getPart(instance.part);
  if (!part) return null;
  return part.build(instance.id, { ...partDefaults(part), ...instance.values });
}

/** Every port an instance currently exposes. The inspector and the canvas share this. */
export function portsOf(doc: EditorDocument, instance: Instance): readonly Port[] {
  return blockOf(doc, instance)?.ports ?? [];
}

/**
 * The document as a plain `Diagram`, for the renderer and the exporter.
 *
 * Note what this throws away: the positions. That is deliberate — a `Diagram` is
 * position-free by definition, and this conversion is what lets the editor hand
 * its work to `layout()` for auto-arrange, or to the same exporter the problem
 * catalogue uses. Positions travel separately, in `place.ts`.
 */
export function toDiagram(doc: EditorDocument): Diagram {
  const blocks: Block[] = [];
  for (const instance of Object.values(doc.instances)) {
    const block = blockOf(doc, instance);
    if (block) blocks.push(block);
  }

  const alive = new Set(blocks.map((b) => b.id));
  const portsById = new Map(blocks.map((b) => [b.id, new Set(b.ports.map((p) => p.id))]));
  const links: Link[] = [];
  for (const l of Object.values(doc.links)) {
    if (!alive.has(l.from.block) || !alive.has(l.to.block)) continue;
    if (!portsById.get(l.from.block)?.has(l.from.port)) continue;
    if (!portsById.get(l.to.block)?.has(l.to.port)) continue;
    links.push({
      id: l.id,
      from: l.from,
      to: l.to,
      ...(l.width !== undefined ? { width: l.width } : {}),
      ...(l.label !== undefined ? { label: l.label } : {}),
      ...(l.style !== undefined ? { style: l.style } : {}),
      ...(l.color !== undefined ? { color: l.color } : {}),
    });
  }

  return { id: "editor", title: doc.title, blocks, links };
}

// --- serialisation ----------------------------------------------------------

export const DOCUMENT_FORMAT = "gatelab.diagram.v1";

interface Envelope {
  readonly format: string;
  readonly document: EditorDocument;
}

export const serialize = (doc: EditorDocument): string =>
  JSON.stringify({ format: DOCUMENT_FORMAT, document: doc } satisfies Envelope, null, 2);

/**
 * Parse a saved document, and REFUSE anything that is not one.
 *
 * A file picker will happily hand you a photo or somebody's tax return, and
 * `JSON.parse` will happily produce an object with no instances — which would
 * silently replace the user's work with an empty canvas. So the shape is checked
 * before anything is returned, and the failure is a message rather than a blank
 * page.
 */
export function deserialize(text: string): { doc: EditorDocument } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That file is not JSON." };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { error: "That file does not contain a diagram." };
  }
  const envelope = parsed as Partial<Envelope>;
  if (envelope.format !== DOCUMENT_FORMAT) {
    return {
      error: `Unrecognised format ${String(envelope.format ?? "(none)")} — expected ${DOCUMENT_FORMAT}.`,
    };
  }
  const doc = envelope.document;
  if (
    !doc ||
    typeof doc !== "object" ||
    typeof doc.instances !== "object" ||
    typeof doc.links !== "object"
  ) {
    return { error: "That file is the right format but its contents are damaged." };
  }

  return {
    doc: {
      title: typeof doc.title === "string" ? doc.title : "Imported circuit",
      instances: doc.instances ?? {},
      links: doc.links ?? {},
      customParts: doc.customParts ?? {},
      seq: typeof doc.seq === "number" ? doc.seq : nextFreeSeq(doc),
    },
  };
}

/** A document written by an older build may have no counter; derive a safe one. */
const nextFreeSeq = (doc: EditorDocument): number => {
  let max = 0;
  for (const id of [...Object.keys(doc.instances ?? {}), ...Object.keys(doc.links ?? {})]) {
    const n = Number.parseInt(id.replace(/^[a-z]+/, ""), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
};

// --- link integrity ---------------------------------------------------------

/**
 * Drop links whose endpoints no longer exist, and say how many went.
 *
 * Reducing a decoder from three address lines to two really does delete Y4–Y7,
 * and any wire attached to them really is gone. The alternative — keeping a
 * dangling link — is worse: it draws nothing, exports nothing, and reappears the
 * moment the parameter is put back, which looks like the tool losing work at
 * random. So they are pruned, and the UI says how many.
 */
export function pruneLinks(doc: EditorDocument): {
  doc: EditorDocument;
  removed: number;
} {
  const ports = new Map<string, Set<string>>();
  for (const instance of Object.values(doc.instances)) {
    ports.set(instance.id, new Set(portsOf(doc, instance).map((p) => p.id)));
  }

  const kept: Record<string, EditorLink> = {};
  let removed = 0;
  for (const [id, link] of Object.entries(doc.links)) {
    const ok =
      ports.get(link.from.block)?.has(link.from.port) === true &&
      ports.get(link.to.block)?.has(link.to.port) === true;
    if (ok) kept[id] = link;
    else removed += 1;
  }

  return { doc: removed === 0 ? doc : { ...doc, links: kept }, removed };
}
