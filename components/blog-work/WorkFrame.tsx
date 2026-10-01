"use client";
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { fitsWindow } from "@/lib/blog-work/geometry";
import { framePatchSchema, type WorkWindow } from "@/lib/blog-work/schemas";
export type WorkFrameValue = WorkWindow & { draftX?: number; draftY?: number };
const edges = [["nw", "左上", 0, 0], ["n", "上", 50, 0], ["ne", "右上", 100, 0], ["e", "右", 100, 50], ["se", "右下", 100, 100], ["s", "下", 50, 100], ["sw", "左下", 0, 100], ["w", "左", 0, 50]] as const;
function resized(frame: WorkFrameValue, edge: string, dx: number, dy: number, scale: number): WorkFrameValue {
  const next: WorkFrameValue = { viewportX: frame.viewportX, viewportY: frame.viewportY, viewportWidth: frame.viewportWidth, viewportHeight: frame.viewportHeight };
  if (edge.includes("w")) { next.viewportX += dx; next.viewportWidth -= dx; }
  if (edge.includes("e")) next.viewportWidth += dx;
  if (edge.includes("n")) { next.viewportY += dy; next.viewportHeight -= dy; }
  if (edge.includes("s")) next.viewportHeight += dy;
  if (frame.draftX !== undefined) next.draftX = frame.draftX + (next.viewportX - frame.viewportX) * scale;
  if (frame.draftY !== undefined) next.draftY = frame.draftY + (next.viewportY - frame.viewportY) * scale;
  return fitsWindow(next) && framePatchSchema.safeParse(next).success ? next : frame;
}
export function WorkFrame({ frame, scale, editing, movable = false, children, onPreview, onCommit }: {
  frame: WorkFrameValue; scale: number; editing: boolean; movable?: boolean; children: ReactNode;
  onPreview: (frame: WorkFrameValue | null) => void;
  onCommit: (frame: WorkFrameValue, kind: "move" | "resize") => void;
}) {
  const gesture = useRef<{ edge: string; kind: "move" | "resize"; pointerId: number; target: HTMLButtonElement; x: number; y: number; scale: number; frame: WorkFrameValue; next: WorkFrameValue } | null>(null);
  const [moving, setMoving] = useState(false), helpId = useId();
  const finish = useCallback(() => {
    const previous = gesture.current;
    gesture.current = null;
    setMoving(false);
    if (previous?.target.hasPointerCapture(previous.pointerId)) previous.target.releasePointerCapture(previous.pointerId);
    onPreview(null);
    return previous;
  }, [onPreview]);
  const cancel = useCallback(() => { if (gesture.current) finish(); }, [finish]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("keydown", escape);
    // 编辑权限/状态变化或卸载时也释放手势，避免隐藏控件后遗留预览。
    return () => { window.removeEventListener("keydown", escape); cancel(); };
  }, [cancel, editing, movable]);
  const moved = (start: WorkFrameValue, dx: number, dy: number): WorkFrameValue => {
    const position = { draftX: (start.draftX ?? 24) + dx, draftY: (start.draftY ?? 40) + dy };
    return framePatchSchema.safeParse(position).success ? { ...start, ...position } : start;
  };
  const pointerDown = (e: PointerEvent<HTMLButtonElement>, kind: "move" | "resize", edge = "") => {
    if (e.button !== 0 || e.isPrimary === false || gesture.current) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind, edge, pointerId: e.pointerId, target: e.currentTarget, x: e.pageX, y: e.pageY, scale, frame, next: frame };
    setMoving(kind === "move");
  };
  const pointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = e.pageX - g.x, dy = e.pageY - g.y;
    g.next = g.kind === "move" ? moved(g.frame, dx, dy) : resized(g.frame, g.edge, dx / g.scale, dy / g.scale, g.scale);
    onPreview(g.next);
  };
  const pointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (gesture.current?.pointerId !== e.pointerId) return;
    const g = finish();
    if (g && ["viewportX", "viewportY", "viewportWidth", "viewportHeight", "draftX", "draftY"].some(key => g.next[key as keyof WorkFrameValue] !== g.frame[key as keyof WorkFrameValue])) onCommit(g.next, g.kind);
  };
  const pointerCancel = (e: PointerEvent<HTMLButtonElement>) => { if (gesture.current?.pointerId === e.pointerId) cancel(); };
  const keyDown = (e: React.KeyboardEvent<HTMLButtonElement>, kind: "move" | "resize", edge = "") => {
    if (e.key === "Escape") { cancel(); return; }
    const step = e.shiftKey ? 10 : 1, vector = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!vector) return;
    e.preventDefault(); e.stopPropagation();
    if (gesture.current) return;
    onCommit(kind === "move" ? moved(frame, vector[0], vector[1]) : resized(frame, edge, vector[0], vector[1], scale), kind);
  };
  const pointerHandlers = { onPointerMove: pointerMove, onPointerUp: pointerUp, onPointerCancel: pointerCancel, onLostPointerCapture: pointerCancel };
  return <div className={`work-frame ${editing ? "work-frame-editing" : ""} ${moving ? "work-frame-moving" : ""}`} style={{ width: frame.viewportWidth * scale, height: frame.viewportHeight * scale }}>
    {children}
    {editing && movable && <>
      <span id={helpId} className="sr-only">方向键平移，Shift 加方向键每次移动 10 像素；拖动时按 Escape 取消。</span>
      {[["n", "上"], ["e", "右"], ["s", "下"], ["w", "左"]].map(([edge, name]) => <button key={edge} type="button" className={`work-frame-move work-frame-move-${edge}`} aria-label={`平移草稿${name}边框`} aria-describedby={helpId}
        onPointerDown={e => pointerDown(e, "move")} onKeyDown={e => keyDown(e, "move")} {...pointerHandlers} />)}
    </>}
    {editing && edges.map(([edge, name, left, top]) => <button key={edge} type="button" className="work-frame-handle" style={{ left: `${left}%`, top: `${top}%`, cursor: `${edge}-resize` }} aria-label={`调整草稿${name}边界`}
      onPointerDown={e => pointerDown(e, "resize", edge)} onKeyDown={e => keyDown(e, "resize", edge)} {...pointerHandlers}
    />)}
  </div>;
}
