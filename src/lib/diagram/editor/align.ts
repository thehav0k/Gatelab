import type { DiagramTheme } from "../theme";
import type { EditorDocument } from "./document";
import { portPositions } from "./place";

/**
 * The magnet that makes wires straight.
 *
 * WHY THIS EXISTS. Blocks snap to an 8px grid, but a PIN does not sit on the
 * grid — it sits at a fraction of its block's height, and that height comes
 * from the block's own contents. A decoder is 92 tall, a 2-input gate is 42,
 * and their pins therefore almost never land on the same line. So the router,
 * doing exactly as it was told, drew a tiny two-bend jog into nearly every
 * wire: a 3px step in the middle of a run that should plainly have been
 * straight. Nothing was broken and every drawing looked slightly wrong.
 *
 * The fix cannot live in the router, because a route's endpoints are the pins
 * and the router may not move them. It has to be the BLOCK that moves — which
 * makes it an editing gesture, and this is it: while a block is being dragged,
 * if one of its wires is within a few pixels of running straight, the block is
 * pulled the rest of the way. It is the same behaviour as a snap-to-guide in a
 * drawing program, and it means "straight" is the default result of a rough
 * drag rather than something you have to nudge into place with arrow keys.
 *
 * Deliberately NOT applied outside a drag: silently moving blocks somebody has
 * already positioned — on load, on paste, on undo — is the tool arguing with
 * them.
 */

export interface Nudge {
  readonly dx: number;
  readonly dy: number;
}

export const NO_NUDGE: Nudge = { dx: 0, dy: 0 };

/** How far a block will be pulled to make one of its wires straight. */
export const ALIGN_TOLERANCE = 7;

const horizontal = (v: { x: number; y: number }): boolean => v.y === 0 && v.x !== 0;
const vertical = (v: { x: number; y: number }): boolean => v.x === 0 && v.y !== 0;
const free = (v: { x: number; y: number }): boolean => v.x === 0 && v.y === 0;

export function alignNudge(
  doc: EditorDocument,
  moving: readonly string[],
  theme: DiagramTheme,
  tolerance = ALIGN_TOLERANCE,
): Nudge {
  if (moving.length === 0) return NO_NUDGE;
  const inMotion = new Set(moving);
  const ports = portPositions(doc, theme);

  const dxs: number[] = [];
  const dys: number[] = [];

  for (const link of Object.values(doc.links)) {
    const fromMoving = inMotion.has(link.from.block);
    const toMoving = inMotion.has(link.to.block);
    // Both ends moving means the wire's shape is unchanged by the drag; neither
    // end moving means this wire has nothing to say about it.
    if (fromMoving === toMoving) continue;

    const from = ports.get(`${link.from.block}.${link.from.port}`);
    const to = ports.get(`${link.to.block}.${link.to.port}`);
    if (!from || !to) continue;

    const mover = fromMoving ? from : to;
    const fixed = fromMoving ? to : from;

    // A wire runs straight when both pins face along the same axis and the
    // other coordinate matches. A junction faces nowhere, so it takes its axis
    // from the pin at the far end.
    const axis =
      horizontal(mover.out) && horizontal(fixed.out)
        ? "y"
        : vertical(mover.out) && vertical(fixed.out)
          ? "x"
          : free(mover.out)
            ? horizontal(fixed.out)
              ? "y"
              : vertical(fixed.out)
                ? "x"
                : null
            : free(fixed.out)
              ? horizontal(mover.out)
                ? "y"
                : "x"
              : null;
    if (axis === null) continue;

    const delta = axis === "y" ? fixed.ay - mover.ay : fixed.ax - mover.ax;
    if (Math.abs(delta) > tolerance) continue;
    (axis === "y" ? dys : dxs).push(delta);
  }

  return { dx: consensus(dxs), dy: consensus(dys) };
}

/**
 * The offset that straightens the MOST wires, and among equals the smallest
 * one.
 *
 * Counting matters for buses: four address lines from one register to the next
 * all want the same shift, and that shift should beat a single stray wire that
 * happens to want a 1px one.
 */
function consensus(deltas: readonly number[]): number {
  if (deltas.length === 0) return 0;
  const tally = new Map<number, number>();
  for (const d of deltas) {
    const key = Math.round(d);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [value, count] of tally) {
    if (count > bestCount || (count === bestCount && Math.abs(value) < Math.abs(best))) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
