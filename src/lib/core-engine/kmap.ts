import { cubeCovers, cubeEliminated, cubeLabel } from "./minimizer";
import { bitOf, type Cube } from "./types";

/**
 * K-map geometry.
 *
 * THE RULE (pitfall #7): adjacency is Hamming distance on the *minterm index*,
 * not adjacency on the *screen*. Neighbours are found by flipping one bit of the
 * index; screen coordinates are computed only at render time. Do it in that
 * order and wrap-around needs zero special cases — the cell at column 0 and the
 * cell at column 3 are neighbours because their indices differ in one bit, full
 * stop, with no "and also check the edges" clause anywhere.
 *
 * The consequence is that a loop's *screen footprint* can be several disjoint
 * rectangles. A group wrapping the left and right edges is one implicant but two
 * boxes; a group wrapping all four corners is one implicant but four boxes. So
 * the type is GridRect[], never GridRect. Getting this wrong is the single most
 * common K-map rendering bug.
 *
 * The loops themselves are NOT computed here. They are the Quine-McCluskey prime
 * implicants, handed over and drawn (Invariant 4). A second, independent
 * grouping algorithm would be two chances to be wrong and two answers to
 * reconcile.
 */

export const MAX_KMAP_VARIABLES = 4;

export interface KMapLayout {
  readonly variables: readonly string[];
  /** Variables encoded down the rows (the high bits). */
  readonly rowVariables: readonly string[];
  /** Variables encoded across the columns (the low bits). */
  readonly colVariables: readonly string[];
  readonly rows: number;
  readonly cols: number;
  /** cellIndex[row][col] -> minterm index. */
  readonly cellIndex: readonly (readonly number[])[];
  /** Gray-code header labels, e.g. ["00", "01", "11", "10"]. */
  readonly rowLabels: readonly string[];
  readonly colLabels: readonly string[];
  /** Inverse of cellIndex. */
  readonly positionOf: readonly { readonly row: number; readonly col: number }[];
}

export interface GridRect {
  readonly row: number;
  readonly col: number;
  readonly rowSpan: number;
  readonly colSpan: number;
}

export interface KMapLoop {
  readonly cube: Cube;
  readonly label: string;
  /** The variables that cancelled out inside this group. */
  readonly eliminated: readonly string[];
  readonly cells: readonly number[];
  /** 1, 2, or 4 boxes. More than one means the group wraps an edge or the corners. */
  readonly rects: readonly GridRect[];
  readonly wraps: boolean;
  /** 0-5, indexing the --color-loop-N design tokens. */
  readonly colorIndex: number;
}

/** Reflected binary (Gray) code: successive values differ in exactly one bit. */
export const gray = (i: number): number => i ^ (i >>> 1);

/**
 * Row/column split. Rows take the high-order variables, columns the low-order,
 * which keeps the minterm index a plain concatenation: m = (rowGray << ck) | colGray.
 */
function split(n: number): { rowBits: number; colBits: number } {
  switch (n) {
    case 1:
      return { rowBits: 0, colBits: 1 };
    case 2:
      return { rowBits: 1, colBits: 1 };
    case 3:
      return { rowBits: 1, colBits: 2 };
    case 4:
      return { rowBits: 2, colBits: 2 };
    default:
      throw new Error(`kmapLayout: ${n} variables is outside 1..${MAX_KMAP_VARIABLES}`);
  }
}

export function kmapLayout(variables: readonly string[]): KMapLayout {
  const n = variables.length;
  const { rowBits, colBits } = split(n);

  const rows = 1 << rowBits;
  const cols = 1 << colBits;

  const cellIndex: number[][] = [];
  const positionOf: { row: number; col: number }[] = new Array<{
    row: number;
    col: number;
  }>(1 << n);

  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      // THE MSB CONTRACT: variables[0] is the high bit, and the row variables are
      // the high ones, so the row's Gray value sits above the column's.
      const m = (gray(r) << colBits) | gray(c);
      row.push(m);
      positionOf[m] = { row: r, col: c };
    }
    cellIndex.push(row);
  }

  const bits = (value: number, width: number): string =>
    width === 0 ? "" : value.toString(2).padStart(width, "0");

  return {
    variables,
    rowVariables: variables.slice(0, rowBits),
    colVariables: variables.slice(rowBits),
    rows,
    cols,
    cellIndex,
    rowLabels: Array.from({ length: rows }, (_, r) => bits(gray(r), rowBits)),
    colLabels: Array.from({ length: cols }, (_, c) => bits(gray(c), colBits)),
    positionOf,
  };
}

/**
 * Turn prime implicants into drawable loops.
 *
 * The cells of a cube form a Cartesian product: the cube constrains some row
 * variables and some column variables independently, so the covered cells are
 * exactly (matching rows) x (matching columns). That is why we can compute the
 * rectangles by finding the matching rows and columns separately and crossing
 * them, instead of flood-filling the grid.
 *
 * Each axis's matching set may be non-contiguous on screen (that IS a wrap), so
 * we split each into maximal contiguous runs. rects = rowRuns x colRuns, which
 * yields 1, 2, or 4 boxes and never needs an edge special-case.
 */
export function kmapLoops(
  cubes: readonly Cube[],
  layout: KMapLayout,
): KMapLoop[] {
  return cubes.map((cube, i) => {
    const matchingRows: number[] = [];
    const matchingCols: number[] = [];

    // A row matches if *any* cell in it is covered; because the cube is a product
    // of independent row/column constraints, "any" and "all its matching columns"
    // agree, and this needs no knowledge of which bits are row bits.
    for (let r = 0; r < layout.rows; r++) {
      if ((layout.cellIndex[r] as number[]).some((m) => cubeCovers(cube, m))) {
        matchingRows.push(r);
      }
    }
    for (let c = 0; c < layout.cols; c++) {
      if (
        layout.cellIndex.some((row) => cubeCovers(cube, row[c] as number))
      ) {
        matchingCols.push(c);
      }
    }

    const rowRuns = contiguousRuns(matchingRows);
    const colRuns = contiguousRuns(matchingCols);

    const rects: GridRect[] = [];
    for (const rr of rowRuns) {
      for (const cr of colRuns) {
        rects.push({
          row: rr.start,
          col: cr.start,
          rowSpan: rr.length,
          colSpan: cr.length,
        });
      }
    }

    const cells: number[] = [];
    for (const r of matchingRows) {
      for (const c of matchingCols) {
        cells.push((layout.cellIndex[r] as number[])[c] as number);
      }
    }
    cells.sort((a, b) => a - b);

    return {
      cube,
      label: cubeLabel(cube, layout.variables),
      eliminated: cubeEliminated(cube, layout.variables),
      cells,
      rects,
      wraps: rects.length > 1,
      colorIndex: i % 6,
    };
  });
}

/** Maximal contiguous runs of a sorted index list. [0,1,3] -> [0..1], [3..3]. */
function contiguousRuns(
  sorted: readonly number[],
): { start: number; length: number }[] {
  const runs: { start: number; length: number }[] = [];
  for (const i of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.start + last.length === i) last.length += 1;
    else runs.push({ start: i, length: 1 });
  }
  return runs;
}

/**
 * The Hamming-1 neighbours of a minterm. This is the *definition* of K-map
 * adjacency; everything else is a rendering detail.
 */
export function neighbours(m: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(m ^ (1 << i));
  return out.sort((a, b) => a - b);
}

/** The literal assignment of a cell, for tooltips: `A=0 B=1 C=1`. */
export function cellAssignment(
  m: number,
  variables: readonly string[],
): { variable: string; value: 0 | 1 }[] {
  const n = variables.length;
  return variables.map((variable, i) => ({ variable, value: bitOf(m, i, n) }));
}
