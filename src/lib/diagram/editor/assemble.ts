import { layout } from "../layout";
import type { DiagramTheme } from "../theme";
import { emptyDocument, toDiagram, type EditorDocument } from "./document";
import { addFromPalette, connect, placeInstances, setValues } from "./ops";
import type { PartValues } from "./parts";

/**
 * A scratchpad for building a document out of parts.
 *
 * Everything that generates a circuit — the starter templates, and the
 * synthesizer that turns an equation into blocks — goes through this. The point
 * is that it can only produce documents the EDITOR could have produced: every
 * block comes from the palette, every wire goes through the same `connect()` the
 * canvas calls, so a generated circuit cannot contain a pin that does not exist
 * or a link the connection rules would have refused.
 *
 * It throws on a bad wire rather than skipping it. A generator with a typo
 * should fail in the test suite, not draw a diagram with one wire quietly
 * missing — which is indistinguishable from a diagram that is simply wrong.
 */
export class Assembler {
  doc: EditorDocument;

  constructor(title: string) {
    this.doc = emptyDocument(title);
  }

  /**
   * Add to a document that already exists, rather than starting a new one.
   *
   * This is what "wire up the decoder I already placed" needs: the same
   * generation code, but appending to the user's canvas instead of replacing it.
   */
  static wrapping(doc: EditorDocument): Assembler {
    const a = new Assembler(doc.title);
    a.doc = doc;
    return a;
  }

  /** Is anything already attached to this pin? */
  wired(block: string, port: string): boolean {
    return Object.values(this.doc.links).some(
      (l) =>
        (l.from.block === block && l.from.port === port) ||
        (l.to.block === block && l.to.port === port),
    );
  }

  /** Wire only if the destination pin is still free. Returns whether it did. */
  wireIfFree(from: [string, string], to: [string, string]): boolean {
    if (this.wired(to[0], to[1])) return false;
    this.wire(from, to);
    return true;
  }

  add(part: string, x: number, y: number, values: PartValues = {}): string {
    const added = addFromPalette(this.doc, part, x, y);
    if (!added) throw new Error(`assemble: no part "${part}"`);
    this.doc = added.doc;
    if (Object.keys(values).length > 0) {
      this.doc = setValues(this.doc, added.id, values).doc;
    }
    return added.id;
  }

  wire(from: [string, string], to: [string, string]): void {
    const result = connect(
      this.doc,
      { block: from[0], port: from[1] },
      { block: to[0], port: to[1] },
    );
    if (!result.ok) {
      throw new Error(`assemble: ${from[0]}.${from[1]} → ${to[0]}.${to[1]}: ${result.reason}`);
    }
    this.doc = result.doc;
  }

  /**
   * Lay it out left-to-right.
   *
   * Not a second layout engine — the SAME layered placement the solutions use,
   * with its coordinates written back as ordinary positions. A generator
   * therefore does not have to guess where anything goes, and what it produces
   * is still an ordinary document that can be dragged around afterwards.
   */
  arrange(theme: DiagramTheme): EditorDocument {
    const tidy = layout(toDiagram(this.doc), theme);
    const positions = new Map(tidy.blocks.map((b) => [b.block.id, { x: b.x, y: b.y }]));
    this.doc = placeInstances(this.doc, positions);
    return this.doc;
  }
}
