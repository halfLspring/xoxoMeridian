import { describe, expect, it } from "vitest";
import { clipPolygon, fitsWindow, polygonCentroid, rotatedCorners, sceneToScreen, screenToScene, visibleAnchor } from "@/lib/blog-work/geometry";
const viewport = { viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540 };
describe("作品裁切与连线几何", () => {
  it.each([0.2, 0.5, 1, 2])("缩放 %s 和滚动可逆且不改变场景", scale => {
    const p = { x: -48, y: 560 }, origin = { x: 30, y: -180 }, crop = { x: -120, y: 72 };
    const result = screenToScene(sceneToScreen(p, origin, crop, scale), origin, crop, scale);
    expect(result.x).toBeCloseTo(p.x, 10); expect(result.y).toBeCloseTo(p.y, 10);
  });
  it("旋转 AABB 的右上空角不能绘制端点", () => {
    const image = { x: 0, y: 0, width: 640, height: 640 }, corners = rotatedCorners(image, 25);
    const right = Math.max(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y));
    const empty = { x: right - 160, y: top, width: 160, height: 120 };
    expect(polygonCentroid(clipPolygon(corners, empty))).toBeNull();
    expect(visibleAnchor(image, 25, [{ ...empty, width: 360, height: 360 }])).not.toBeNull();
  });
  it.each([-25, 0, 25])("局部可见图片 %s° 的锚点落在真实可见部分", angle => {
    const p = visibleAnchor({ x: 0, y: 0, width: 640, height: 320 }, angle, [{ x: 420, y: 100, width: 150, height: 100 }]);
    expect(p).not.toBeNull(); expect(p!.x).toBeGreaterThanOrEqual(420); expect(p!.x).toBeLessThanOrEqual(570);
  });
  it("边或点相切时没有端点", () => {
    expect(visibleAnchor({ x: 0, y: 0, width: 100, height: 100 }, 0, [{ x: 100, y: 0, width: 100, height: 100 }])).toBeNull();
    expect(visibleAnchor({ x: 0, y: 0, width: 100, height: 100 }, 0, [{ x: 100, y: 100, width: 100, height: 100 }])).toBeNull();
  });
  it("三角形面积质心不是包围盒中心", () => {
    expect(polygonCentroid([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 6 }])).toEqual({ x: 2, y: 2 });
  });
  it.each([
    [160, 120, true], [8192, 8192, true], [159, 120, false],
    [160, 119, false], [8193, 120, false], [160, 8193, false],
  ])("手柄窗口 %s×%s 的尺寸约束为 %s", (viewportWidth, viewportHeight, valid) => {
    expect(fitsWindow({ ...viewport, viewportWidth, viewportHeight })).toBe(valid);
  });
  it("扩大窗口恢复裁掉的端点", () => {
    const photo = { x: 300, y: 100, width: 200, height: 200 };
    expect(visibleAnchor(photo, 0, [{ x: 0, y: 0, width: 160, height: 120 }])).toBeNull();
    expect(visibleAnchor(photo, 0, [{ x: 0, y: 0, width: 960, height: 540 }])).toEqual({ x: 400, y: 200 });
  });
});
