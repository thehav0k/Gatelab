import { describe, expect, it } from "vitest";
import {
  buildRoundedOrthogonalSvgPath,
  routeBreadboardWires,
  type BreadboardChannelConfig,
  type WireRouteInput,
} from "./breadboard-router";

const config: BreadboardChannelConfig = {
  topPanelGutterY: 85,
  upperStripGutterY: 160,
  centerRavineY: 325,
  lowerStripGutterY: 490,
  bottomPanelGutterY: 565,
  laneSpacing: 5,
  cornerRadius: 6,
};

describe("breadboard-router", () => {
  it("routes a collinear vertical wire as a 2-point vertical line", () => {
    const wires: WireRouteInput[] = [
      { id: "w1", from: { x: 100, y: 50 }, to: { x: 100, y: 200 }, color: "#ef4444" },
    ];
    const routed = routeBreadboardWires(wires, config);
    expect(routed).toHaveLength(1);
    expect(routed[0]!.points).toHaveLength(2);
    expect(routed[0]!.channelId).toBe("vertical");
    expect(routed[0]!.svgPath).toBe("M 100 50 L 100 200");
  });

  it("routes standard wires through the closest channel without IC obstacles", () => {
    const wires: WireRouteInput[] = [
      { id: "w1", from: { x: 50, y: 80 }, to: { x: 200, y: 90 }, color: "#ef4444" },
    ];
    const routed = routeBreadboardWires(wires, config);
    expect(routed).toHaveLength(1);
    expect(routed[0]!.channelId).toBe("topPanelGutter");
    expect(routed[0]!.points).toHaveLength(4);
    // Path should start at from, go to channel Y, go to to.x at channel Y, and down to to.y
    expect(routed[0]!.points[0]).toEqual({ x: 50, y: 80 });
    expect(routed[0]!.points[1]?.y).toBe(config.topPanelGutterY);
    expect(routed[0]!.points[2]?.y).toBe(config.topPanelGutterY);
    expect(routed[0]!.points[3]).toEqual({ x: 200, y: 90 });
  });

  it("avoids center ravine if an IC obstacle sits in its horizontal path", () => {
    const wires: WireRouteInput[] = [
      { id: "w1", from: { x: 100, y: 310 }, to: { x: 300, y: 340 }, color: "#3b82f6" },
    ];
    const icObstacles = [{ id: "ic1", minX: 150, minY: 300, maxX: 250, maxY: 350 }];
    const routed = routeBreadboardWires(wires, config, icObstacles);
    expect(routed).toHaveLength(1);
    // Should NOT take centerRavine because of the IC
    expect(routed[0]!.channelId).not.toBe("centerRavine");
    expect(["upperStripGutter", "lowerStripGutter"]).toContain(routed[0]!.channelId);
  });

  it("assigns separate parallel tracks (lanes) for overlapping wires in the same channel", () => {
    const wires: WireRouteInput[] = [
      { id: "w1", from: { x: 50, y: 80 }, to: { x: 250, y: 80 }, color: "#ef4444" },
      { id: "w2", from: { x: 100, y: 80 }, to: { x: 200, y: 80 }, color: "#3b82f6" },
    ];
    const routed = routeBreadboardWires(wires, config);
    expect(routed).toHaveLength(2);
    expect(routed[0]!.channelId).toBe(routed[1]!.channelId);
    // Their assigned Y tracks should be different
    expect(routed[0]!.points[1]!.y).not.toEqual(routed[1]!.points[1]!.y);
  });

  it("supports custom user waypoints", () => {
    const wires: WireRouteInput[] = [
      {
        id: "w1",
        from: { x: 50, y: 50 },
        to: { x: 200, y: 200 },
        color: "#10b981",
        waypoints: [{ x: 50, y: 150 }, { x: 200, y: 150 }],
      },
    ];
    const routed = routeBreadboardWires(wires, config);
    expect(routed).toHaveLength(1);
    expect(routed[0]!.points).toHaveLength(4);
    expect(routed[0]!.channelId).toBe("waypoints");
  });

  it("builds smooth rounded orthogonal SVG paths", () => {
    const points = [
      { x: 10, y: 10 },
      { x: 10, y: 100 },
      { x: 100, y: 100 },
    ];
    const path = buildRoundedOrthogonalSvgPath(points, 6);
    expect(path).toContain("M 10 10");
    expect(path).toContain("Q 10.0 100.0");
    expect(path).toContain("L 100 100");
  });

  it("detours collinear vertical wires around an IC obstacle", () => {
    const wires: WireRouteInput[] = [
      { id: "w1", from: { x: 100, y: 50 }, to: { x: 100, y: 350 }, color: "#ef4444" },
    ];
    const icObstacles = [{ id: "ic1", minX: 80, minY: 150, maxX: 120, maxY: 250 }];
    const routed = routeBreadboardWires(wires, config, icObstacles);
    expect(routed).toHaveLength(1);
    expect(routed[0]!.channelId).toBe("vertical-detour");
    expect(routed[0]!.points.length).toBeGreaterThan(2);
    const insideIc = routed[0]!.points.some(
      (p) => p.x > 82 && p.x < 118 && p.y > 152 && p.y < 248,
    );
    expect(insideIc).toBe(false);
  });
});
