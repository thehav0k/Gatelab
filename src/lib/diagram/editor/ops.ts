import { measure, rotatedSize } from "../measure";
import type { DiagramTheme } from "../theme";
import { asRotation, type BlockTone, type Endpoint, type Port, type Rotation, type Side } from "../types";
import {
  blockOf,
  portsOf,
  pruneLinks,
  rotationOf,
  type CustomPart,
  type EditorDocument,
  type EditorLink,
  type Instance,
} from "./document";
import { getPart, partDefaults, type PartValues } from "./parts";

/**
 * Every change the editor can make, as a pure function of the document.
 *
 * WHY NOT METHODS ON A STORE. Undo/redo is a stack of documents, so every
 * operation has to produce a NEW document rather than mutate one — and once that
 * is true, there is no reason for these to live inside React. Out here they are
 * testable without a renderer, which matters because the interesting ones
 * (grouping, ungrouping, pruning links after a parameter change) are exactly the
 * ones whose bugs are invisible on screen until much later.
 */

/** Canvas snap. Small enough to place freely, large enough that wires line up. */
export const GRID = 8;

export const snap = (n: number): number => Math.round(n / GRID) * GRID;

/**
 * A snapped coordinate that can never go negative.
 *
 * The canvas origin is pinned at (0, 0) so that dragging one block past the left
 * edge does not re-origin the sheet and shunt every other block sideways under
 * the pointer. Clamping here is the whole of that guarantee, which is why every
 * position in this file goes through it rather than through `snap`.
 */
const pos = (n: number): number => Math.max(0, snap(n));

const id = (doc: EditorDocument, prefix: string): [string, number] => [
  `${prefix}${doc.seq + 1}`,
  doc.seq + 1,
];

// --- placing ----------------------------------------------------------------

export function addInstance(
  doc: EditorDocument,
  part: string,
  values: PartValues,
  x: number,
  y: number,
): { doc: EditorDocument; id: string } {
  const [instanceId, seq] = id(doc, "b");
  const instance: Instance = {
    id: instanceId,
    part,
    values,
    x: pos(x),
    y: pos(y),
  };
  return {
    doc: { ...doc, seq, instances: { ...doc.instances, [instanceId]: instance } },
    id: instanceId,
  };
}

export function addFromPalette(
  doc: EditorDocument,
  partId: string,
  x: number,
  y: number,
): { doc: EditorDocument; id: string } | null {
  if (partId.startsWith("custom:")) {
    const custom = doc.customParts[partId.slice(7)];
    if (!custom) return null;
    return addInstance(doc, partId, {}, x, y);
  }
  const part = getPart(partId);
  if (!part) return null;
  return addInstance(doc, partId, partDefaults(part), x, y);
}

export function moveInstances(
  doc: EditorDocument,
  ids: readonly string[],
  dx: number,
  dy: number,
): EditorDocument {
  if (ids.length === 0 || (dx === 0 && dy === 0)) return doc;
  const instances = { ...doc.instances };
  for (const instanceId of ids) {
    const instance = instances[instanceId];
    if (!instance) continue;
    instances[instanceId] = {
      ...instance,
      x: pos(instance.x + dx),
      y: pos(instance.y + dy),
    };
  }
  return { ...doc, instances };
}

/**
 * Move a set of blocks to `origin + delta`, from positions captured when the
 * drag STARTED.
 *
 * The obvious implementation — apply the frame's `dx, dy` to wherever the block
 * is now — is wrong, and visibly so, because every step snaps to the grid: a
 * 3px mouse move rounds away to nothing, the next one rounds away too, and the
 * block either sticks or slowly drifts out from under the pointer. Anchoring on
 * the position the block had before the gesture began means the rounding is
 * applied once, to the total, and the block tracks the cursor exactly.
 *
 * `free` skips the grid, for the modifier key that lets somebody place a block
 * exactly where they want it.
 */
export function dragInstances(
  doc: EditorDocument,
  origins: ReadonlyMap<string, { x: number; y: number }>,
  dx: number,
  dy: number,
  free = false,
): EditorDocument {
  if (origins.size === 0) return doc;
  const round = free ? (n: number) => Math.max(0, Math.round(n)) : pos;
  const instances = { ...doc.instances };
  for (const [instanceId, origin] of origins) {
    const instance = instances[instanceId];
    if (!instance) continue;
    instances[instanceId] = {
      ...instance,
      x: round(origin.x + dx),
      y: round(origin.y + dy),
    };
  }
  return { ...doc, instances };
}

/**
 * Shift blocks by an exact amount, OFF the grid.
 *
 * Two callers, and both need the exactness: the alignment magnet, whose whole
 * job is a sub-grid correction, and the arrow keys, where a nudge that rounded
 * back to where it started would look like a broken keyboard.
 */
export function offsetInstances(
  doc: EditorDocument,
  ids: readonly string[],
  dx: number,
  dy: number,
): EditorDocument {
  if (ids.length === 0 || (dx === 0 && dy === 0)) return doc;
  const instances = { ...doc.instances };
  for (const instanceId of ids) {
    const instance = instances[instanceId];
    if (!instance) continue;
    instances[instanceId] = {
      ...instance,
      x: Math.max(0, instance.x + dx),
      y: Math.max(0, instance.y + dy),
    };
  }
  return { ...doc, instances };
}

/**
 * Turn a selection through a multiple of 90 degrees, each block about its own
 * centre.
 *
 * ABOUT ITS OWN CENTRE, not its top-left corner and not the selection's centre.
 * A 92x52 box turned on its corner jumps 20px up and 20px left, which reads as
 * the block having been moved as well as turned; keeping the centre still means
 * the only thing that changes is the thing you asked to change. The centre is
 * then re-snapped, so a rotated block still lines up with everything else.
 */
export function rotateInstances(
  doc: EditorDocument,
  ids: readonly string[],
  delta: number,
  theme: DiagramTheme,
): EditorDocument {
  if (ids.length === 0 || delta % 360 === 0) return doc;
  const instances = { ...doc.instances };
  let changed = false;
  for (const instanceId of ids) {
    const instance = instances[instanceId];
    if (!instance) continue;
    const block = blockOf(doc, instance);
    if (!block) continue;
    const before = rotationOf(instance);
    const after = asRotation(before + delta);
    if (after === before) continue;
    const own = measure(block, theme);
    const oldSize = rotatedSize(own, before);
    const newSize = rotatedSize(own, after);
    instances[instanceId] = {
      ...instance,
      rotation: after,
      x: pos(instance.x + (oldSize.w - newSize.w) / 2),
      y: pos(instance.y + (oldSize.h - newSize.h) / 2),
    };
    changed = true;
  }
  return changed ? { ...doc, instances } : doc;
}

/** Set one block's rotation outright — for the inspector's four buttons. */
export const setRotation = (
  doc: EditorDocument,
  instanceId: string,
  rotation: Rotation,
  theme: DiagramTheme,
): EditorDocument => {
  const instance = doc.instances[instanceId];
  if (!instance) return doc;
  return rotateInstances(doc, [instanceId], rotation - rotationOf(instance), theme);
};

/**
 * Stand every block back up.
 *
 * Auto-arrange runs `layout()`, which works on a position-free `Diagram` and
 * therefore cannot see a rotation — it would size a turned decoder by its
 * upright footprint and lay the next column straight through it. Since the
 * whole point of arranging is a left-to-right dataflow, and a left-to-right
 * dataflow has upright blocks, the two go together: one undoable step that
 * tidies the sheet completely rather than one that tidies it into an overlap.
 */
export function clearRotations(doc: EditorDocument): EditorDocument {
  const turned = Object.values(doc.instances).filter((i) => i.rotation !== undefined);
  if (turned.length === 0) return doc;
  const instances = { ...doc.instances };
  for (const instance of turned) {
    // Deleted rather than set to 0: the field's absence is what "upright" means
    // everywhere else, and a document that round-trips through JSON should not
    // grow a key that says nothing.
    const upright = { ...instance };
    delete (upright as { rotation?: Rotation }).rotation;
    instances[instance.id] = upright;
  }
  return { ...doc, instances };
}

/** Absolute placement, for auto-arrange and for import. */
export function placeInstances(
  doc: EditorDocument,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): EditorDocument {
  const instances = { ...doc.instances };
  for (const [instanceId, at] of positions) {
    const instance = instances[instanceId];
    if (!instance) continue;
    instances[instanceId] = { ...instance, x: pos(at.x), y: pos(at.y) };
  }
  return { ...doc, instances };
}

/**
 * Change a placed block's parameters.
 *
 * Parameters change the PORTS, so this is also the one operation that can orphan
 * a wire — narrow a decoder and its top outputs genuinely cease to exist. The
 * links that referred to them are pruned here and the count is reported, so the
 * UI can say so instead of the wire quietly vanishing.
 */
export function setValues(
  doc: EditorDocument,
  instanceId: string,
  values: PartValues,
): { doc: EditorDocument; removedLinks: number } {
  const instance = doc.instances[instanceId];
  if (!instance) return { doc, removedLinks: 0 };
  const next: EditorDocument = {
    ...doc,
    instances: {
      ...doc.instances,
      [instanceId]: { ...instance, values: { ...instance.values, ...values } },
    },
  };
  const pruned = pruneLinks(next);
  return { doc: pruned.doc, removedLinks: pruned.removed };
}

export function duplicate(
  doc: EditorDocument,
  ids: readonly string[],
  offset = 24,
): { doc: EditorDocument; ids: string[] } {
  const selected = ids.map((i) => doc.instances[i]).filter((i): i is Instance => !!i);
  if (selected.length === 0) return { doc, ids: [] };

  let seq = doc.seq;
  const instances = { ...doc.instances };
  const remap = new Map<string, string>();
  for (const instance of selected) {
    seq += 1;
    const newId = `b${seq}`;
    remap.set(instance.id, newId);
    instances[newId] = {
      ...instance,
      id: newId,
      x: pos(instance.x + offset),
      y: pos(instance.y + offset),
    };
  }

  // Links WHOLLY inside the copied set come with it; links to the outside do
  // not, because a copy that silently re-drives somebody else's input is a
  // surprise, not a convenience.
  const links = { ...doc.links };
  for (const link of Object.values(doc.links)) {
    const from = remap.get(link.from.block);
    const to = remap.get(link.to.block);
    if (!from || !to) continue;
    seq += 1;
    const newId = `w${seq}`;
    links[newId] = {
      ...link,
      id: newId,
      from: { block: from, port: link.from.port },
      to: { block: to, port: link.to.port },
    };
  }

  return { doc: { ...doc, seq, instances, links }, ids: [...remap.values()] };
}

export function removeSelection(
  doc: EditorDocument,
  instanceIds: readonly string[],
  linkIds: readonly string[] = [],
): EditorDocument {
  const gone = new Set(instanceIds);
  const instances = Object.fromEntries(
    Object.entries(doc.instances).filter(([key]) => !gone.has(key)),
  );
  const droppedLinks = new Set(linkIds);
  const links = Object.fromEntries(
    Object.entries(doc.links).filter(
      ([key, link]) =>
        !droppedLinks.has(key) && !gone.has(link.from.block) && !gone.has(link.to.block),
    ),
  );
  return { ...doc, instances, links };
}

// --- wiring -----------------------------------------------------------------

export type ConnectResult =
  | { readonly ok: true; readonly doc: EditorDocument; readonly id: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Wire two ports together.
 *
 * Two rules, and each exists because the alternative produces a drawing that
 * lies:
 *
 *   - A port cannot connect to itself, and the same pair cannot be wired twice.
 *     A duplicate link draws exactly on top of the first and is undeletable by
 *     clicking, because the click hits the one on top forever.
 *   - When exactly one end is an OUTPUT, it becomes the source. Otherwise the
 *     arrowhead points backwards, and on a block diagram the arrow IS the
 *     statement about which way the signal flows.
 *
 * NOTE WHAT IS *NOT* A RULE: an input pin may take more than one wire. This
 * started out forbidden — a pin with two drivers is a bus fight — and it was
 * wrong, because a shared data bus is exactly that shape and exactly correct:
 * four memory chips drive one bus and the chip select decides which. Enforcing
 * one wire per pin silently deleted three quarters of every memory diagram.
 *
 * The distinction that matters is that this is a DRAWING tool, not a simulator.
 * The lab is where a double-driven net is a fault with a diagnostic; here it is
 * a thing people legitimately draw, and refusing to draw it — or worse, dropping
 * the earlier wire without saying so — is the tool being wrong about the domain.
 */
export function connect(
  doc: EditorDocument,
  a: Endpoint,
  b: Endpoint,
): ConnectResult {
  if (a.block === b.block && a.port === b.port) {
    return { ok: false, reason: "A pin cannot be wired to itself." };
  }
  const from = doc.instances[a.block];
  const to = doc.instances[b.block];
  if (!from || !to) return { ok: false, reason: "One of those blocks is gone." };

  const portA = portsOf(doc, from).find((p) => p.id === a.port);
  const portB = portsOf(doc, to).find((p) => p.id === b.port);
  if (!portA || !portB) return { ok: false, reason: "One of those pins is gone." };

  // Orient the link so the output end is the source.
  //
  // A junction has no direction of its own, so when exactly one end is one the
  // OTHER end decides: wiring a gate's output to a junction makes the gate the
  // source whichever way round the user happened to drag. Two junctions keep
  // the order they were drawn in, which is the only information there is.
  const swap =
    bidi(portA) === bidi(portB)
      ? portA.dir === "in" && portB.dir === "out"
      : bidi(portA)
        ? portB.dir === "out"
        : portA.dir === "in";
  const source = swap ? b : a;
  const target = swap ? a : b;

  const already = Object.values(doc.links).some(
    (l) =>
      (same(l.from, source) && same(l.to, target)) ||
      (same(l.from, target) && same(l.to, source)),
  );
  if (already) return { ok: false, reason: "Those two pins are already wired together." };

  const [linkId, seq] = id(doc, "w");
  const width = widthOf(portA, portB);
  const link: EditorLink = {
    id: linkId,
    from: source,
    to: target,
    ...(width > 1 ? { width } : {}),
  };
  return {
    ok: true,
    doc: { ...doc, seq, links: { ...doc.links, [linkId]: link } },
    id: linkId,
  };
}

const bidi = (port: Port): boolean => port.bidirectional === true;

const same = (a: Endpoint, b: Endpoint): boolean =>
  a.block === b.block && a.port === b.port;

/** A link is a bus if either end is. Wider wins, so a 8-bit pin into a 1-bit one shows 8. */
const widthOf = (a: Port, b: Port): number => Math.max(a.width ?? 1, b.width ?? 1);

/**
 * What can be changed about a wire.
 *
 * Every field admits `undefined` explicitly, and that is the point: "no colour
 * of its own" is a state the user can choose, not merely the state a wire
 * starts in. Without it there would be a button to override a wire's colour and
 * no way back to automatic.
 */
export interface LinkPatch {
  readonly label?: string | undefined;
  readonly width?: number | undefined;
  readonly style?: "solid" | "dashed" | undefined;
  readonly color?: string | undefined;
}

export function setLink(
  doc: EditorDocument,
  linkId: string,
  patch: LinkPatch,
): EditorDocument {
  const link = doc.links[linkId];
  if (!link) return doc;
  const next = { ...link } as EditorLink & Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    // Deleted rather than stored as undefined: the document is JSON, and a key
    // whose value is undefined does not survive the round trip anyway.
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return { ...doc, links: { ...doc.links, [linkId]: next } };
}

// --- hierarchy --------------------------------------------------------------

export type GroupResult =
  | { readonly ok: true; readonly doc: EditorDocument; readonly id: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Fold a selection into ONE reusable block. The heart of the whole editor.
 *
 * Which pins the new block gets is the entire design question, and the answer is
 * two rules:
 *
 *   1. Every Input / Output / Clock tag INSIDE the selection becomes a pin. This
 *      is the deliberate way to build a block — drop the tags in, wire them up,
 *      group, and the block has exactly the interface you drew.
 *   2. Every wire that CROSSES the selection boundary becomes a pin too, on the
 *      inner pin it was attached to. Without this rule, grouping a subcircuit
 *      that was already wired into something else would silently cut those
 *      wires; with it, the connections survive and land on the new block.
 *
 * Several outside wires arriving at one inner pin share a single new pin,
 * because they are one signal — the same reason a fan-out is one net.
 */
/** Which side of a group's boundary each IO tag becomes. See the note in `group`. */
const IO_ROLE: Readonly<Record<string, "in" | "out" | undefined>> = {
  input: "in",
  clock: "in",
  output: "out",
};

export function group(
  doc: EditorDocument,
  instanceIds: readonly string[],
  name: string,
  tone: BlockTone = "msi",
): GroupResult {
  const selected = instanceIds
    .map((i) => doc.instances[i])
    .filter((i): i is Instance => i !== undefined);
  if (selected.length === 0) return { ok: false, reason: "Nothing is selected." };

  const inside = new Set(selected.map((i) => i.id));
  const ports: Port[] = [];
  const boundary: Record<string, Endpoint> = {};
  const portFor = new Map<string, string>(); // "block.port" -> outer port id
  const used = new Set<string>();

  const claim = (base: string): string => {
    let candidate = base || "P";
    let n = 2;
    while (used.has(candidate)) candidate = `${base}${n++}`;
    used.add(candidate);
    return candidate;
  };

  const addPort = (inner: Endpoint, label: string, dir: "in" | "out"): string => {
    const key = `${inner.block}.${inner.port}`;
    const existing = portFor.get(key);
    if (existing) return existing;
    const portId = claim(label.replace(/[^\w']/g, "") || (dir === "in" ? "IN" : "OUT"));
    ports.push({ id: portId, label, side: (dir === "in" ? "left" : "right") as Side, dir });
    boundary[portId] = inner;
    portFor.set(key, portId);
    return portId;
  };

  // Rule 1 — the IO tags inside become the interface, in the order they appear.
  //
  // THE DIRECTION FLIPS AT THE BOUNDARY, and it is easy to get backwards. An
  // Input tag's own pin is an OUTPUT — it drives the circuit around it — but from
  // the outside the block it belongs to has an INPUT there. Taking the direction
  // from the inner pin puts every input on the right-hand side of the new block
  // and every output on the left, which is not a cosmetic error: the router,
  // the arrowheads and `connect()`'s source/target orientation all read it.
  for (const instance of selected) {
    const role = IO_ROLE[instance.part];
    if (!role) continue;
    const block = blockOf(doc, instance);
    const port = block?.ports[0];
    if (!block || !port) continue;
    addPort({ block: instance.id, port: port.id }, block.title, role);
  }

  // Rule 2 — anything the outside world was already wired to.
  for (const link of Object.values(doc.links)) {
    const fromIn = inside.has(link.from.block);
    const toIn = inside.has(link.to.block);
    if (fromIn === toIn) continue;
    const inner = fromIn ? link.from : link.to;
    const instance = doc.instances[inner.block];
    if (!instance) continue;
    const block = blockOf(doc, instance);
    const port = block?.ports.find((p) => p.id === inner.port);
    if (!block || !port) continue;
    const label = block.kind === "io" ? block.title : `${block.title} ${port.label || port.id}`;
    addPort(inner, label.trim(), port.dir);
  }

  if (ports.length === 0) {
    return {
      ok: false,
      reason:
        "That selection has no pins to expose. Put an Input or Output tag inside it, or select something already wired to the rest of the circuit.",
    };
  }

  // The body keeps its own shape, normalised so the group can be dropped anywhere.
  const x0 = Math.min(...selected.map((i) => i.x));
  const y0 = Math.min(...selected.map((i) => i.y));
  const bodyInstances = Object.fromEntries(
    selected.map((i) => [i.id, { ...i, x: i.x - x0, y: i.y - y0 }]),
  );
  const bodyLinks = Object.fromEntries(
    Object.entries(doc.links).filter(
      ([, l]) => inside.has(l.from.block) && inside.has(l.to.block),
    ),
  );

  let seq = doc.seq + 1;
  const customId = `c${seq}`;
  seq += 1;
  const instanceId = `b${seq}`;

  const custom: CustomPart = {
    id: customId,
    name,
    subtitle: `${selected.length} block${selected.length === 1 ? "" : "s"}`,
    tone,
    ports: [...ports.filter((p) => p.dir === "in"), ...ports.filter((p) => p.dir === "out")],
    body: {
      title: name,
      instances: bodyInstances,
      links: bodyLinks,
      customParts: doc.customParts,
      seq: doc.seq,
    },
    boundary,
  };

  const instances = Object.fromEntries(
    Object.entries(doc.instances).filter(([key]) => !inside.has(key)),
  );
  instances[instanceId] = {
    id: instanceId,
    part: `custom:${customId}`,
    values: {},
    x: pos(x0),
    y: pos(y0),
  };

  // Boundary wires now land on the new block; inner wires went inside it.
  const links: Record<string, EditorLink> = {};
  for (const [key, link] of Object.entries(doc.links)) {
    const fromIn = inside.has(link.from.block);
    const toIn = inside.has(link.to.block);
    if (fromIn && toIn) continue;
    if (!fromIn && !toIn) {
      links[key] = link;
      continue;
    }
    const inner = fromIn ? link.from : link.to;
    const portId = portFor.get(`${inner.block}.${inner.port}`);
    if (!portId) continue;
    const rewired: Endpoint = { block: instanceId, port: portId };
    links[key] = fromIn ? { ...link, from: rewired } : { ...link, to: rewired };
  }

  return {
    ok: true,
    id: instanceId,
    doc: {
      ...doc,
      seq,
      instances,
      links,
      customParts: { ...doc.customParts, [customId]: custom },
    },
  };
}

/**
 * Take a custom block apart again, putting its contents back where it stood.
 *
 * The subtle half is what happens to the IO tags that became the block's pins.
 * If nothing outside was wired to a pin, its tag is simply restored — it is a
 * legitimate input of the flattened circuit. But if something WAS wired to it,
 * restoring the tag would leave two drivers on one net: the outside signal and
 * the tag itself. So in that case the tag is DISSOLVED and the outside wire is
 * connected straight through to whatever the tag was feeding, which is what the
 * user meant by wiring into the block in the first place.
 */
export function ungroup(
  doc: EditorDocument,
  instanceId: string,
): { ok: true; doc: EditorDocument; ids: string[] } | { ok: false; reason: string } {
  const instance = doc.instances[instanceId];
  if (!instance || !instance.part.startsWith("custom:")) {
    return { ok: false, reason: "That is not a grouped block." };
  }
  const custom = doc.customParts[instance.part.slice(7)];
  if (!custom) return { ok: false, reason: "That block's definition is missing." };

  let seq = doc.seq;
  const remap = new Map<string, string>();
  const instances = { ...doc.instances };
  delete instances[instanceId];

  for (const inner of Object.values(custom.body.instances)) {
    seq += 1;
    const newId = `b${seq}`;
    remap.set(inner.id, newId);
    instances[newId] = {
      ...inner,
      id: newId,
      x: pos(instance.x + inner.x),
      y: pos(instance.y + inner.y),
    };
  }

  const outward = (e: Endpoint): Endpoint => ({
    block: remap.get(e.block) ?? e.block,
    port: e.port,
  });

  const innerLinks = Object.values(custom.body.links).map((l) => ({
    ...l,
    from: outward(l.from),
    to: outward(l.to),
  }));

  /** Tags that an outside wire has taken the place of. */
  const dissolved = new Set<string>();
  const links: Record<string, EditorLink> = {};
  const emit = (link: Omit<EditorLink, "id">): void => {
    seq += 1;
    links[`w${seq}`] = { ...link, id: `w${seq}` };
  };

  for (const link of Object.values(doc.links)) {
    const touchesFrom = link.from.block === instanceId;
    const touchesTo = link.to.block === instanceId;
    if (!touchesFrom && !touchesTo) {
      links[link.id] = link;
      continue;
    }

    const outerPort = touchesFrom ? link.from.port : link.to.port;
    const boundaryEnd = custom.boundary[outerPort];
    if (!boundaryEnd) continue;

    const innerInstance = custom.body.instances[boundaryEnd.block];
    const role = innerInstance ? IO_ROLE[innerInstance.part] : undefined;
    const resolved = outward(boundaryEnd);

    if (!role) {
      // A pin that came from a crossing wire: it names a real inner pin, so the
      // outside wire simply lands on it.
      emit(touchesFrom ? { ...link, from: resolved } : { ...link, to: resolved });
      continue;
    }

    dissolved.add(resolved.block);
    if (role === "in") {
      // Outside driver -> everything the tag was feeding inside.
      for (const inner of innerLinks) {
        if (inner.from.block !== resolved.block) continue;
        emit({ from: link.from, to: inner.to, ...widthAndStyle(link) });
      }
    } else {
      // Whatever fed the tag inside -> everything outside it was driving.
      for (const inner of innerLinks) {
        if (inner.to.block !== resolved.block) continue;
        emit({ from: inner.from, to: link.to, ...widthAndStyle(link) });
      }
    }
  }

  // Inner wiring, minus anything that ran to a tag the outside world replaced.
  for (const inner of innerLinks) {
    if (dissolved.has(inner.from.block) || dissolved.has(inner.to.block)) continue;
    seq += 1;
    links[`w${seq}`] = { ...inner, id: `w${seq}` };
  }
  for (const gone of dissolved) delete instances[gone];

  const ids = [...remap.values()].filter((i) => !dissolved.has(i));
  return { ok: true, doc: { ...doc, seq, instances, links }, ids };
}

const widthAndStyle = (l: EditorLink) => ({
  ...(l.width !== undefined ? { width: l.width } : {}),
  ...(l.label !== undefined ? { label: l.label } : {}),
  ...(l.style !== undefined ? { style: l.style } : {}),
});

/** Forget a custom part. Refused while it is still on the canvas. */
export function deleteCustomPart(
  doc: EditorDocument,
  customId: string,
): { ok: true; doc: EditorDocument } | { ok: false; reason: string } {
  const inUse = Object.values(doc.instances).some((i) => i.part === `custom:${customId}`);
  if (inUse) {
    return { ok: false, reason: "That block is still used on the canvas. Delete or ungroup it first." };
  }
  const customParts = { ...doc.customParts };
  delete customParts[customId];
  return { ok: true, doc: { ...doc, customParts } };
}

// --- merging ----------------------------------------------------------------

/**
 * Drop one document into another.
 *
 * Used by "build this equation" and by "insert a template", both of which
 * generate a self-contained little circuit that has to join whatever is already
 * on the canvas without colliding with it. Every id is renumbered from the
 * target's counter, so nothing an undo brings back can clash with something a
 * redo puts down.
 *
 * Custom parts come across too, and are renumbered on the same counter. Reusing
 * an id because "it is probably the same block" would be a guess, and getting it
 * wrong means somebody's grouped adder silently turns into somebody else's.
 */
export function mergeDocument(
  target: EditorDocument,
  incoming: EditorDocument,
  offset: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): { doc: EditorDocument; ids: string[] } {
  let seq = target.seq;
  const customs = new Map<string, string>();
  const customParts = { ...target.customParts };
  for (const [id, part] of Object.entries(incoming.customParts)) {
    seq += 1;
    const newId = `c${seq}`;
    customs.set(id, newId);
    customParts[newId] = { ...part, id: newId };
  }

  const remap = new Map<string, string>();
  const instances = { ...target.instances };
  for (const instance of Object.values(incoming.instances)) {
    seq += 1;
    const newId = `b${seq}`;
    remap.set(instance.id, newId);
    const custom = instance.part.startsWith("custom:")
      ? customs.get(instance.part.slice(7))
      : undefined;
    instances[newId] = {
      ...instance,
      id: newId,
      part: custom ? `custom:${custom}` : instance.part,
      x: pos(instance.x + offset.x),
      y: pos(instance.y + offset.y),
    };
  }

  const links = { ...target.links };
  for (const link of Object.values(incoming.links)) {
    const from = remap.get(link.from.block);
    const to = remap.get(link.to.block);
    if (!from || !to) continue;
    seq += 1;
    const newId = `w${seq}`;
    links[newId] = {
      ...link,
      id: newId,
      from: { block: from, port: link.from.port },
      to: { block: to, port: link.to.port },
    };
  }

  return {
    doc: { ...target, seq, instances, links, customParts },
    ids: [...remap.values()],
  };
}

/**
 * Somewhere clear of everything already on the canvas.
 *
 * Deliberately below rather than beside: a diagram grows to the right as signals
 * flow, so the space to the right of the last block is usually where the next
 * wire is going, and dropping a new circuit into it lands on top of the work.
 */
export function freeSpaceBelow(doc: EditorDocument, gap = 160): { x: number; y: number } {
  const used = Object.values(doc.instances);
  if (used.length === 0) return { x: 40, y: 40 };
  return {
    x: Math.min(...used.map((i) => i.x)),
    y: Math.max(...used.map((i) => i.y)) + gap,
  };
}
