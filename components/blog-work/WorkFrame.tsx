"use client";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { fitsWindow } from "@/lib/blog-work/geometry";
import type { WorkWindow } from "@/lib/blog-work/schemas";
const edges = [["nw", "左上", 0, 0], ["n", "上", 50, 0], ["ne", "右上", 100, 0], ["e", "右", 100, 50], ["se", "右下", 100, 100], ["s", "下", 50, 100], ["sw", "左下", 0, 100], ["w", "左", 0, 50]] as const;
function resized(frame: WorkWindow, edge: string, dx: number, dy: number): WorkWindow {
  const next: WorkWindow = { viewportX: frame.viewportX, viewportY: frame.viewportY, viewportWidth: frame.viewportWidth, viewportHeight: frame.viewportHeight };
  if (edge.includes("w")) { next.viewportX += dx; next.viewportWidth -= dx; }
  if (edge.includes("e")) next.viewportWidth += dx;
  if (edge.includes("n")) { next.viewportY += dy; next.viewportHeight -= dy; }
  if (edge.includes("s")) next.viewportHeight += dy;
  return fitsWindow(next) ? next : frame;
}
export function WorkFrame({ frame, scale, editing, children, onPreview, onCommit }: {
  frame: WorkWindow; scale: number; editing: boolean; children: ReactNode;
  onPreview: (frame: WorkWindow) => void; onCommit: (frame: WorkWindow) => void;
}) {
  const gesture = useRef<{ edge: string; x: number; y: number; frame: WorkWindow; next: WorkWindow } | null>(null);
  const cancel = useCallback(() => { if (gesture.current) onPreview(gesture.current.frame); gesture.current = null; }, [onPreview]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [cancel]);
  return <div className={`work-frame ${editing ? "work-frame-editing" : ""}`} style={{ width: frame.viewportWidth * scale, height: frame.viewportHeight * scale }}>
    {children}
    {editing && edges.map(([edge, name, left, top]) => <button key={edge} type="button" className="work-frame-handle" style={{ left: `${left}%`, top: `${top}%`, cursor: `${edge}-resize` }} aria-label={`调整草稿${name}边界`}
      onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); gesture.current = { edge, x: e.clientX, y: e.clientY, frame, next: frame }; }}
      onPointerMove={e => { const g = gesture.current; if (!g) return; g.next = resized(g.frame, edge, (e.clientX - g.x) / scale, (e.clientY - g.y) / scale); onPreview(g.next); }}
      onPointerUp={e => { if (!gesture.current) return; const next = gesture.current.next; gesture.current = null; e.currentTarget.releasePointerCapture(e.pointerId); onCommit(next); }}
      onPointerCancel={cancel} onLostPointerCapture={cancel}
      onKeyDown={e => { if (e.key === "Escape") { cancel(); return; } const step = e.shiftKey ? 10 : 1, vector = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]; if (!vector) return; e.preventDefault(); onCommit(resized(frame, edge, vector[0], vector[1])); }}
    />)}
  </div>;
}
