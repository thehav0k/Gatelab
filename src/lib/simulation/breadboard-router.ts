/**
 * Breadboard Orthogonal Channel Router & Rounded SVG Path Generator
 * - Eliminates diagonal/curved jumper entanglement
 * - Separates parallel wires into distinct horizontal tracks (Interval Graph Coloring)
 * - Orders lanes to minimize vertical/horizontal wire crossings
 * - Avoids 74xx DIP IC body bounding boxes in the central ravine
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface BoundingBox {
  readonly id: string;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface WireRouteInput {
  readonly id: string;
  readonly from: Point;
  readonly to: Point;
  readonly color: string;
  /** Optional user-dragged custom Y coordinate for the horizontal segment */
  readonly customChannelY?: number | undefined;
  /** Optional intermediate waypoints clicked by the user */
  readonly waypoints?: readonly Point[] | undefined;
}

export interface RoutedWire {
  readonly id: string;
  readonly color: string;
  readonly points: readonly Point[];
  readonly svgPath: string;
  /** Midpoint of the main horizontal segment for rendering a drag handle */
  readonly handlePoint: Point;
  readonly channelId: string;
  readonly laneIndex: number;
}

export interface BreadboardChannelConfig {
  /** Y coordinate of the channel between Top Trainer Panel and Top Power Rails */
  readonly topPanelGutterY: number;
  /** Y coordinate between Top Power Rails and Row J */
  readonly upperStripGutterY: number;
  /** Y coordinate of the center DIP ravine (between Row F and Row E) */
  readonly centerRavineY: number;
  /** Y coordinate between Row A and Bottom Power Rails */
  readonly lowerStripGutterY: number;
  /** Y coordinate between Bottom Power Rails and Bottom Switch Panel */
  readonly bottomPanelGutterY: number;
  /** Distance in px between parallel wire tracks in the same channel */
  readonly laneSpacing?: number | undefined;
  /** Corner bend radius in px */
  readonly cornerRadius?: number | undefined;
}

interface ChannelCandidate {
  readonly id: string;
  readonly baseY: number;
}

interface PendingSegment {
  readonly wire: WireRouteInput;
  readonly channelId: string;
  readonly baseY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly directionScore: number;
}

/**
 * Detects if a vertical line segment at coordinate `x` between `y1` and `y2`
 * cuts across any placed IC chip body.
 */
export function getIntersectedIc(
  x: number,
  y1: number,
  y2: number,
  icObstacles: readonly BoundingBox[],
): BoundingBox | undefined {
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return icObstacles.find((ic) => {
    // Only counts as intersecting if x is within the IC's horizontal span
    // and the vertical travel crosses into the IC body
    const xInSpan = x >= ic.minX + 2 && x <= ic.maxX - 2;
    const yCrosses = !(maxY <= ic.minY + 4 || minY >= ic.maxY - 4);
    return xInSpan && yCrosses;
  });
}

/**
 * Routes a vertical segment at `x` from `y1` to `y2` around an IC if it intersects one.
 */
export function routeAroundIcVertical(
  from: Point,
  to: Point,
  ic: BoundingBox,
): Point[] {
  const goingDown = from.y < to.y;
  const bypassX =
    from.x <= (ic.minX + ic.maxX) / 2 ? ic.minX - 10 : ic.maxX + 10;
  const yEntry = goingDown ? ic.minY - 6 : ic.maxY + 6;
  const yExit = goingDown ? ic.maxY + 6 : ic.minY - 6;

  return [
    from,
    { x: from.x, y: yEntry },
    { x: bypassX, y: yEntry },
    { x: bypassX, y: yExit },
    { x: to.x, y: yExit },
    to,
  ];
}

/**
 * 1. Select the cleanest horizontal routing channel for a wire
 *    while avoiding DIP-14 IC bodies in the central ravine.
 */
function selectBestChannel(
  wire: WireRouteInput,
  config: BreadboardChannelConfig,
  icObstacles: readonly BoundingBox[],
): ChannelCandidate {
  if (typeof wire.customChannelY === "number") {
    return { id: `custom:${wire.id}`, baseY: wire.customChannelY };
  }

  const channels: readonly ChannelCandidate[] = [
    { id: "topPanelGutter", baseY: config.topPanelGutterY },
    { id: "upperStripGutter", baseY: config.upperStripGutterY },
    { id: "centerRavine", baseY: config.centerRavineY },
    { id: "lowerStripGutter", baseY: config.lowerStripGutterY },
    { id: "bottomPanelGutter", baseY: config.bottomPanelGutterY },
  ];

  const minX = Math.min(wire.from.x, wire.to.x);
  const maxX = Math.max(wire.from.x, wire.to.x);

  // Check if a horizontal run through any channel would intersect an IC
  const hitsIcInChannel = (y: number) =>
    icObstacles.some(
      (ic) =>
        maxX > ic.minX - 4 &&
        minX < ic.maxX + 4 &&
        y >= ic.minY - 2 &&
        y <= ic.maxY + 2,
    );

  let bestChannel = channels[0]!;
  let bestCost = Infinity;

  for (const ch of channels) {
    // If the horizontal line through this channel directly hits any IC body, heavily penalize it
    const obstaclePenalty = hitsIcInChannel(ch.baseY) ? 20000 : 0;

    // Also penalize channels that require vertical travel across an IC
    const vHits1 = getIntersectedIc(wire.from.x, wire.from.y, ch.baseY, icObstacles) ? 5000 : 0;
    const vHits2 = getIntersectedIc(wire.to.x, ch.baseY, wire.to.y, icObstacles) ? 5000 : 0;

    // Total vertical travel required to enter this channel and reach destination
    const verticalTravel =
      Math.abs(wire.from.y - ch.baseY) + Math.abs(wire.to.y - ch.baseY);

    const totalCost = verticalTravel + obstaclePenalty + vHits1 + vHits2;
    if (totalCost < bestCost) {
      bestCost = totalCost;
      bestChannel = ch;
    }
  }

  return bestChannel;
}

/**
 * 2. Greedy Interval Coloring + Crossing Minimization
 *    Assigns non-overlapping horizontal tracks (lanes) to wires in the same channel.
 */
function assignChannelLanes(
  segments: readonly PendingSegment[],
  laneSpacing: number,
): Map<string, { y: number; laneIndex: number }> {
  const result = new Map<string, { y: number; laneIndex: number }>();
  if (segments.length === 0) return result;

  // Sort primarily by nesting/direction score and left X so outer spans don't cross inner spans
  const sorted = [...segments].sort((a, b) => {
    if (Math.abs(a.directionScore - b.directionScore) > 1) {
      return a.directionScore - b.directionScore;
    }
    if (a.minX !== b.minX) return a.minX - b.minX;
    return (b.maxX - b.minX) - (a.maxX - a.minX);
  });

  // Each lane tracks the rightmost X coordinate occupied so far
  const laneLastMaxX: number[] = [];
  const wireLaneIndex = new Map<string, number>();

  const HORIZONTAL_CLEARANCE = 8; // px buffer between collinear wire ends

  for (const seg of sorted) {
    let assignedLane = -1;
    for (let i = 0; i < laneLastMaxX.length; i++) {
      if (seg.minX >= (laneLastMaxX[i] ?? 0) + HORIZONTAL_CLEARANCE) {
        assignedLane = i;
        laneLastMaxX[i] = seg.maxX;
        break;
      }
    }

    if (assignedLane === -1) {
      assignedLane = laneLastMaxX.length;
      laneLastMaxX.push(seg.maxX);
    }

    wireLaneIndex.set(seg.wire.id, assignedLane);
  }

  const totalLanes = laneLastMaxX.length;
  for (const seg of sorted) {
    const laneIdx = wireLaneIndex.get(seg.wire.id) ?? 0;
    // Center the bundle of lanes around the channel's baseY
    const offset = (laneIdx - (totalLanes - 1) / 2) * laneSpacing;
    result.set(seg.wire.id, {
      y: Math.round((seg.baseY + offset) * 2) / 2,
      laneIndex: laneIdx,
    });
  }

  return result;
}

/**
 * 3. Convert orthogonal polyline points into a smooth rounded-corner SVG path string (`M ... L ... Q ...`)
 */
export function buildRoundedOrthogonalSvgPath(
  points: readonly Point[],
  cornerRadius = 6,
): string {
  // Remove consecutive duplicate points
  const pts = points.filter(
    (p, idx) =>
      idx === 0 ||
      Math.hypot(p.x - points[idx - 1]!.x, p.y - points[idx - 1]!.y) > 0.5,
  );

  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`;
  if (pts.length === 2) {
    return `M ${pts[0]!.x} ${pts[0]!.y} L ${pts[1]!.x} ${pts[1]!.y}`;
  }

  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const curr = pts[i]!;
    const next = pts[i + 1]!;

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const len1 = Math.hypot(v1x, v1y);

    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len2 = Math.hypot(v2x, v2y);

    // Clamp radius to at most 45% of the shorter adjacent segment
    const r = Math.min(cornerRadius, len1 * 0.45, len2 * 0.45);

    if (r < 1) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const startArcX = curr.x - (v1x / len1) * r;
    const startArcY = curr.y - (v1y / len1) * r;
    const endArcX = curr.x + (v2x / len2) * r;
    const endArcY = curr.y + (v2y / len2) * r;

    d += ` L ${startArcX.toFixed(1)} ${startArcY.toFixed(1)}`;
    d += ` Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)} ${endArcX.toFixed(1)} ${endArcY.toFixed(1)}`;
  }

  const last = pts[pts.length - 1]!;
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * 4. Master Router Entry Point
 *    Takes all wires on the breadboard + IC bounding boxes and returns clean, non-overlapping paths.
 */
export function routeBreadboardWires(
  wires: readonly WireRouteInput[],
  config: BreadboardChannelConfig,
  icObstacles: readonly BoundingBox[] = [],
): RoutedWire[] {
  const laneSpacing = config.laneSpacing ?? 5;
  const cornerRadius = config.cornerRadius ?? 6;

  // Group wires by chosen horizontal channel
  const channelGroups = new Map<string, PendingSegment[]>();

  for (const wire of wires) {
    // If the user explicitly clicked manual waypoints, respect them directly
    if (wire.waypoints && wire.waypoints.length > 0) {
      continue;
    }

    const chosen = selectBestChannel(wire, config, icObstacles);
    const minX = Math.min(wire.from.x, wire.to.x);
    const maxX = Math.max(wire.from.x, wire.to.x);

    // Direction score puts wires pulling upward toward top lanes and wires pulling downward toward bottom lanes
    const avgEndpointY = (wire.from.y + wire.to.y) / 2;
    const directionScore = avgEndpointY - chosen.baseY;

    const list = channelGroups.get(chosen.id) ?? [];
    list.push({
      wire,
      channelId: chosen.id,
      baseY: chosen.baseY,
      minX,
      maxX,
      directionScore,
    });
    channelGroups.set(chosen.id, list);
  }

  // Compute lane Y offsets per channel
  const wireChannelAssignment = new Map<
    string,
    { channelId: string; y: number; laneIndex: number }
  >();

  for (const [channelId, group] of channelGroups.entries()) {
    const laneMap = assignChannelLanes(group, laneSpacing);
    for (const [wireId, laneData] of laneMap.entries()) {
      wireChannelAssignment.set(wireId, {
        channelId,
        y: laneData.y,
        laneIndex: laneData.laneIndex,
      });
    }
  }

  // Construct final orthogonal polylines and SVG paths
  return wires.map((wire) => {
    // Case A: User-specified waypoints
    if (wire.waypoints && wire.waypoints.length > 0) {
      const pts = [wire.from, ...wire.waypoints, wire.to];
      const midIdx = Math.floor(pts.length / 2);
      return {
        id: wire.id,
        color: wire.color,
        points: pts,
        svgPath: buildRoundedOrthogonalSvgPath(pts, cornerRadius),
        handlePoint: pts[midIdx]!,
        channelId: "waypoints",
        laneIndex: 0,
      };
    }

    // Case B: Vertical-only collinear connection (same column X)
    if (Math.abs(wire.from.x - wire.to.x) < 1) {
      const hitIc = getIntersectedIc(wire.from.x, wire.from.y, wire.to.y, icObstacles);
      if (hitIc) {
        const pts = routeAroundIcVertical(wire.from, wire.to, hitIc);
        return {
          id: wire.id,
          color: wire.color,
          points: pts,
          svgPath: buildRoundedOrthogonalSvgPath(pts, cornerRadius),
          handlePoint: pts[Math.floor(pts.length / 2)]!,
          channelId: "vertical-detour",
          laneIndex: 0,
        };
      }
      const pts = [wire.from, wire.to];
      return {
        id: wire.id,
        color: wire.color,
        points: pts,
        svgPath: buildRoundedOrthogonalSvgPath(pts, cornerRadius),
        handlePoint: {
          x: wire.from.x,
          y: (wire.from.y + wire.to.y) / 2,
        },
        channelId: "vertical",
        laneIndex: 0,
      };
    }

    // Case C: Standard 3-segment Manhattan route (VerticalStub -> HorizontalChannel -> VerticalStub)
    const assigned = wireChannelAssignment.get(wire.id) ?? {
      channelId: "centerRavine",
      y: config.centerRavineY,
      laneIndex: 0,
    };

    const p1 = wire.from;
    const p2 = { x: wire.from.x, y: assigned.y };
    const p3 = { x: wire.to.x, y: assigned.y };
    const p4 = wire.to;

    const hitIc1 = getIntersectedIc(p1.x, p1.y, p2.y, icObstacles);
    const hitIc2 = getIntersectedIc(p4.x, p3.y, p4.y, icObstacles);

    const leg1 = hitIc1 ? routeAroundIcVertical(p1, p2, hitIc1) : [p1, p2];
    const leg2 = hitIc2 ? routeAroundIcVertical(p3, p4, hitIc2) : [p3, p4];

    const rawPoints = [...leg1, ...leg2];
    const points: Point[] = [];
    for (const pt of rawPoints) {
      if (
        points.length === 0 ||
        Math.hypot(pt.x - points[points.length - 1]!.x, pt.y - points[points.length - 1]!.y) > 0.5
      ) {
        points.push(pt);
      }
    }

    const handlePoint = {
      x: (p2.x + p3.x) / 2,
      y: assigned.y,
    };

    return {
      id: wire.id,
      color: wire.color,
      points,
      svgPath: buildRoundedOrthogonalSvgPath(points, cornerRadius),
      handlePoint,
      channelId: assigned.channelId,
      laneIndex: assigned.laneIndex,
    };
  });
}
