import { describe, expect, it } from "vitest";
import { photoPatchChanged } from "@/lib/blog-work/photo-patch";
import type { WorkElement } from "@/lib/blog-work/types";

const photo: WorkElement = {
  id: "photo", workId: "work", postId: null, type: "photo",
  x: 161.3559322033898, y: 390.6779661016949, width: 240, height: 180,
  rotation: 0, zIndex: 0, imageUrl: "/test.png", caption: "图片",
  content: null, createdById: "author", createdAt: "2026-10-04T00:00:00Z",
};

describe("图片预览与已保存几何的等价判断", () => {
  it("取消恢复的缩放值与 PG 回读尾差等价，混合真实修改仍为脏数据", () => {
    const cancelled = { x: 161.35593220338984, y: 390.67796610169495 };
    expect(photoPatchChanged(photo, cancelled)).toBe(false);
    expect(photoPatchChanged(photo, { ...cancelled, caption: "新标注" })).toBe(true);
    expect(photoPatchChanged(photo, {})).toBe(false);
  });

  it.each(["x", "y", "width", "height", "rotation"] as const)("%s 只容忍浮点单位，亚像素或亚角度修改仍为脏数据", key => {
    for (const value of [-1e6, -25, 0, 25, 1e6]) {
      const stored = { ...photo, [key]: value };
      expect(photoPatchChanged(stored, { [key]: value })).toBe(false);
      expect(photoPatchChanged(stored, { [key]: value + Number.EPSILON * Math.max(1, Math.abs(value)) })).toBe(false);
      expect(photoPatchChanged(stored, { [key]: value + 1e-8 })).toBe(true);
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("无效数字 %s 不能被视为已保存的等价几何", value => {
    expect(photoPatchChanged(photo, { x: value })).toBe(true);
    expect(photoPatchChanged({ ...photo, x: value }, { x: value })).toBe(true);
  });

  it("标注、层级和资源字段仍严格比较", () => {
    expect(photoPatchChanged(photo, { caption: "图片 ", zIndex: photo.zIndex })).toBe(true);
    expect(photoPatchChanged(photo, { zIndex: photo.zIndex + Number.EPSILON })).toBe(true);
    expect(photoPatchChanged(photo, { imageUrl: "/other.png" })).toBe(true);
    expect(photoPatchChanged(photo, { caption: null })).toBe(true);
    expect(photoPatchChanged(photo, { caption: photo.caption, zIndex: photo.zIndex })).toBe(false);
  });
});
