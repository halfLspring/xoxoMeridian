import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { flushSync } from "react-dom";
import { expect, it, vi } from "vitest";

import { HomePhotoElement } from "@/components/home/HomePhotoElement";

function props(): ComponentProps<typeof HomePhotoElement> {
  return {
    element: { id: "photo", type: "photo", x: 80, y: 350, width: 240, height: 180, rotation: 0,
      zIndex: 1, content: null, imageUrl: "/photo.svg", caption: "手势", createdById: "owner", createdAt: "2026-10-04T00:00:00Z" },
    viewScale: 0.5, deleting: false, selected: false, onSelect: vi.fn(), onMove: vi.fn(), onMoveEnd: vi.fn(),
    onResizePreview: vi.fn(), onResizeEnd: vi.fn(), onRotate: vi.fn(), onRotateEnd: vi.fn(),
    onCaption: vi.fn(), onDelete: vi.fn(), registerAnchor: () => () => {},
  };
}

function capture(target: HTMLElement) {
  const pointers = new Set<number>();
  Object.assign(target, {
    setPointerCapture: (id: number) => pointers.add(id),
    hasPointerCapture: (id: number) => pointers.has(id),
    releasePointerCapture: (id: number) => pointers.delete(id),
  });
  return pointers;
}

it("同一次 Escape 的较早监听器重渲染后仍取消，使用最新回调且释放 capture", () => {
  const initial = props(), latestMove = vi.fn();
  let rerender: () => void = () => {};
  const earlier = (event: KeyboardEvent) => { if (event.key === "Escape") flushSync(rerender); };
  window.addEventListener("keydown", earlier);
  try {
    const view = render(<HomePhotoElement {...initial} />);
    rerender = () => view.rerender(<HomePhotoElement {...initial} onMove={latestMove} />);
    const photo = screen.getByRole("img", { name: "手势" }).closest<HTMLElement>("[data-home-photo]")!;
    const pointers = capture(photo);
    fireEvent.pointerDown(photo, { button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(photo, { pointerId: 1, clientX: 120, clientY: 110 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(photo, { pointerId: 1, clientX: 120, clientY: 110 });
    expect(latestMove).toHaveBeenCalledWith("photo", 80, 350);
    expect(initial.onMoveEnd).not.toHaveBeenCalled();
    expect(pointers.size).toBe(0);
  } finally { window.removeEventListener("keydown", earlier); }
});

it.each(["移动", "缩放"])("%s手势忽略其他指针的按下、预览、释放和取消，所属指针只提交一次", mode => {
  const initial = props();
  render(<HomePhotoElement {...initial} />);
  const photo = screen.getByRole("img", { name: "手势" }).closest<HTMLElement>("[data-home-photo]")!;
  const target = mode === "移动" ? photo : screen.getByRole("button", { name: "调整照片大小：手势" });
  const pointers = capture(target);
  const owner = { button: 0, pointerId: 2, clientX: 100, clientY: 100, isPrimary: true };
  const other = { button: 0, pointerId: 3, clientX: 300, clientY: 300, isPrimary: false };
  fireEvent.pointerDown(target, owner);
  fireEvent.pointerDown(target, other);
  fireEvent.pointerMove(target, { ...other, clientX: 320 });
  fireEvent.pointerUp(target, other);
  fireEvent.pointerCancel(target, other);
  fireEvent.lostPointerCapture(target, other);
  expect(initial.onMove).not.toHaveBeenCalled();
  expect(initial.onResizePreview).not.toHaveBeenCalled();
  expect(initial.onMoveEnd).not.toHaveBeenCalled();
  expect(initial.onResizeEnd).not.toHaveBeenCalled();
  fireEvent.pointerMove(target, { ...owner, clientX: 120 });
  fireEvent.pointerUp(target, { ...owner, clientX: 120 });
  fireEvent.pointerUp(target, { ...owner, clientX: 120 });
  if (mode === "移动") expect(initial.onMoveEnd).toHaveBeenCalledExactlyOnceWith("photo", 120, 350);
  else expect(initial.onResizeEnd).toHaveBeenCalledExactlyOnceWith("photo", 280, 210);
  expect(pointers.size).toBe(0);
});

it.each([
  { name: "微小抖动仍是点击", offset: 1, selects: true },
  { name: "拖动回原点仍是拖动", offset: 20, selects: false },
])("$name，不产生错误接线或微小位置保存", ({ offset, selects }) => {
  const initial = props();
  render(<HomePhotoElement {...initial} />);
  const photo = screen.getByRole("img", { name: "手势" }).closest<HTMLElement>("[data-home-photo]")!;
  capture(photo);
  const pointer = { button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 100 };
  fireEvent.pointerDown(photo, pointer);
  fireEvent.pointerMove(photo, { ...pointer, clientX: 100 + offset });
  fireEvent.pointerUp(photo, pointer);
  expect(initial.onSelect).toHaveBeenCalledTimes(selects ? 1 : 0);
  expect(initial.onMoveEnd).toHaveBeenCalledTimes(selects ? 0 : 1);
  expect(initial.onMove).toHaveBeenCalledTimes(selects ? 0 : 1);
});
