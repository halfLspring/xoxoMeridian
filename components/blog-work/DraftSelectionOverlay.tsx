"use client";
import { useEffect, useRef, useState } from "react";
import type { CreateWorkInput } from "@/lib/blog-work/schemas";
export function DraftSelectionOverlay({ onCreate, onCancel, error, pending }: { onCreate: (input: CreateWorkInput) => void; onCancel: () => void; error: string; pending: boolean }) {
  const root = useRef<HTMLDivElement>(null), start = useRef<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<CreateWorkInput | null>(null);
  const cancelRef = useRef(onCancel); useEffect(() => { cancelRef.current = onCancel; }, [onCancel]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === "Escape") cancelRef.current(); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, []);
  return <div ref={root} className="draft-selection" onPointerDown={e => {
    if (pending || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const rect = e.currentTarget.getBoundingClientRect(); start.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }} onPointerMove={e => { if (!start.current) return; const rect = e.currentTarget.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top; setSelection({ mutationId: "", draftX: Math.min(x, start.current.x), draftY: Math.min(y, start.current.y), viewportX: 0, viewportY: 0, viewportWidth: Math.min(8192, Math.max(160, Math.abs(x - start.current.x))), viewportHeight: Math.min(8192, Math.max(120, Math.abs(y - start.current.y))) }); }} onPointerUp={e => {
    if (!start.current) return; start.current = null;
    if (selection) { const input = { ...selection, mutationId: crypto.randomUUID() }; setSelection(input); onCreate(input); }
    e.currentTarget.releasePointerCapture(e.pointerId);
  }} onPointerCancel={() => { start.current = null; setSelection(null); }} onLostPointerCapture={() => { if (start.current) { start.current = null; setSelection(null); } }}>
    {/* 卡片默认不可见，鼠标用户看到的是干净画布；仅在键盘 Tab 聚焦或创建失败需要恢复时浮现，隐藏态必须对指针透明以免空白处误触。 */}
    <div className="draft-selection-help" data-revealed={error ? "" : undefined} role="group" aria-label="框选草稿区域"><div className="work-actions">{error && selection && <button disabled={pending} onClick={() => onCreate(selection)}>重试创建</button>}<button disabled={pending} onClick={() => { const input = { mutationId: crypto.randomUUID(), draftX: 24, draftY: Math.max(40, window.scrollY), viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540 }; setSelection(input); onCreate(input); }}>使用默认区域</button><button disabled={pending} onClick={onCancel}>取消框选</button></div></div>
    {selection && <div className="draft-selection-rect" style={{ left: selection.draftX, top: selection.draftY, width: selection.viewportWidth, height: selection.viewportHeight }} />}
  </div>;
}
