import type { WorkElement } from "@/lib/blog-work/types";

const geometryFields = new Set<keyof WorkElement>(["x", "y", "width", "height", "rotation"]);

export function photoPatchChanged(stored: WorkElement, patch: Partial<WorkElement>): boolean {
  return (Object.keys(patch) as Array<keyof WorkElement>).some(key => {
    const before = stored[key], after = patch[key];
    if (geometryFields.has(key) && typeof before === "number" && typeof after === "number") {
      // 缩放计算与 PG 回读可差数个浮点单位；只容忍表示尾差，不按像素取整。
      return !Number.isFinite(before) || !Number.isFinite(after)
        || Math.abs(after - before) > 4 * Number.EPSILON * Math.max(1, Math.abs(before), Math.abs(after));
    }
    return after !== before;
  });
}
