import type { WorkWindow } from "@/lib/blog-work/schemas";

export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
const EPSILON = 1e-8;
export function windowRect(window: WorkWindow): Rect {
  return { x: window.viewportX, y: window.viewportY, width: window.viewportWidth, height: window.viewportHeight };
}
export function sceneToScreen(point: Point, origin: Point, viewport: Point, scale: number): Point {
  return { x: origin.x + (point.x - viewport.x) * scale, y: origin.y + (point.y - viewport.y) * scale };
}
export function screenToScene(point: Point, origin: Point, viewport: Point, scale: number): Point {
  return { x: viewport.x + (point.x - origin.x) / scale, y: viewport.y + (point.y - origin.y) / scale };
}
export function rotatedCorners(rect: Rect, degrees = 0): Point[] {
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  const angle = degrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = sx * rect.width / 2, y = sy * rect.height / 2;
    return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
  });
}
// Sutherland–Hodgman：在逻辑坐标裁切凸多边形，AABB 不作为可见性的最终判断。
export function clipPolygon(polygon: Point[], rect: Rect): Point[] {
  let result = polygon;
  const edges: Array<{ axis: "x" | "y"; bound: number; sign: number }> = [
    { axis: "x", bound: rect.x, sign: 1 }, { axis: "x", bound: rect.x + rect.width, sign: -1 },
    { axis: "y", bound: rect.y, sign: 1 }, { axis: "y", bound: rect.y + rect.height, sign: -1 },
  ];
  for (const { axis, bound, sign } of edges) {
    const input = result;
    result = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length];
      const insideA = sign * (a[axis] - bound) >= 0, insideB = sign * (b[axis] - bound) >= 0;
      if (insideA) result.push(a);
      if (insideA !== insideB) {
        const t = (bound - a[axis]) / (b[axis] - a[axis]);
        result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
  }
  return result;
}
export function polygonCentroid(points: Point[]): Point | null {
  let area2 = 0, x = 0, y = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    area2 += cross; x += (a.x + b.x) * cross; y += (a.y + b.y) * cross;
  }
  return Math.abs(area2) <= EPSILON ? null : { x: x / (3 * area2), y: y / (3 * area2) };
}
export function visibleAnchor(rect: Rect, rotation: number, clips: Rect[]): Point | null {
  return polygonCentroid(clips.reduce((p, clip) => clipPolygon(p, clip), rotatedCorners(rect, rotation)));
}
export function fitsWindow(window: WorkWindow): boolean {
  return window.viewportWidth >= 160 && window.viewportHeight >= 120 && window.viewportWidth <= 8192 && window.viewportHeight <= 8192;
}
