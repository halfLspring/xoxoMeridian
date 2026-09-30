"use client";

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, RotateCcw, RotateCw } from "lucide-react";
import { HOME_PHOTO_MAX_ROTATION } from "@/lib/home-spatial";

type RotationGesture = {
  pointerId: number;
  centerX: number;
  centerY: number;
  startX: number;
  startY: number;
  startRotation: number;
  pointerAngle: number;
  rotation: number;
  moved: boolean;
};

const clampRotation = (angle: number) => Math.max(-HOME_PHOTO_MAX_ROTATION, Math.min(HOME_PHOTO_MAX_ROTATION, angle));

export function HomePhotoRotation({
  photoRef, rotation, caption, disabled, onPreview, onCommit,
}: {
  photoRef: RefObject<HTMLDivElement | null>;
  rotation: number;
  caption: string;
  disabled: boolean;
  onPreview: (rotation: number) => void;
  onCommit: (rotation: number) => void;
}) {
  const handleRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLFormElement>(null);
  const gesture = useRef<RotationGesture | null>(null);
  const pendingKeyRotation = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const descriptionId = useId();
  const editorId = useId();
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [editor, setEditor] = useState<{ left: number; top: number } | null>(null);
  const [draft, setDraft] = useState("");

  const releasePointer = (pointerId: number) => {
    if (handleRef.current?.hasPointerCapture(pointerId)) handleRef.current.releasePointerCapture(pointerId);
  };

  const cancelGesture = useCallback(() => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    suppressClick.current = true;
    setDragging(false);
    onPreview(active.startRotation);
    releasePointer(active.pointerId);
  }, [onPreview]);

  useEffect(() => {
    window.addEventListener("blur", cancelGesture);
    return () => window.removeEventListener("blur", cancelGesture);
  }, [cancelGesture]);

  useEffect(() => {
    if (!editor) return;
    const close = () => setEditor(null);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!editorRef.current?.contains(target) && !handleRef.current?.contains(target)) close();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [editor]);

  const previewPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const x = event.clientX + window.scrollX;
    const y = event.clientY + window.scrollY;
    if (!active.moved && Math.hypot(x - active.startX, y - active.startY) < 3) return;
    if (Math.hypot(x - active.centerX, y - active.centerY) < 12) return;
    if (!active.moved) setEditor(null);
    active.moved = true;
    const angle = Math.atan2(y - active.centerY, x - active.centerX) * 180 / Math.PI;
    // 使用按下时固定的中心和连续角度差，避免旋转后的 DOM 边界反过来改变输入。
    const delta = (angle - active.pointerAngle + 540) % 360 - 180;
    active.pointerAngle = angle;
    active.rotation = clampRotation(active.rotation + delta);
    onPreview(Math.round(active.rotation));
  };

  const commitKeys = () => {
    const angle = pendingKeyRotation.current;
    pendingKeyRotation.current = null;
    if (angle !== null && !disabled) onCommit(angle);
  };

  const applyAngle = (angle: number) => {
    if (!Number.isFinite(angle) || Math.abs(angle) > HOME_PHOTO_MAX_ROTATION || disabled) return;
    if (angle !== rotation) onCommit(Math.round(angle));
    setEditor(null);
    handleRef.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <button
        ref={handleRef}
        type="button"
        className={`home-photo-rotate-handle ${dragging || editor ? "is-active" : ""}`}
        style={{ transform: `rotate(${-rotation}deg)` }}
        data-rotation-control
        aria-label={`旋转照片：${caption}`}
        aria-describedby={descriptionId}
        aria-expanded={!!editor}
        aria-controls={editor ? editorId : undefined}
        disabled={disabled}
        title="拖动旋转 · 单击输入角度"
        onPointerDown={(event) => {
          event.stopPropagation();
          if (disabled || event.button !== 0 || !event.isPrimary || gesture.current) return;
          const rect = photoRef.current?.getBoundingClientRect();
          if (!rect) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          const centerX = rect.left + rect.width / 2 + window.scrollX;
          const centerY = rect.top + rect.height / 2 + window.scrollY;
          const startX = event.clientX + window.scrollX;
          const startY = event.clientY + window.scrollY;
          gesture.current = {
            pointerId: event.pointerId, centerX, centerY, startX, startY,
            startRotation: rotation, rotation, moved: false,
            pointerAngle: Math.atan2(startY - centerY, startX - centerX) * 180 / Math.PI,
          };
          suppressClick.current = false;
          setDragging(true);
        }}
        onPointerMove={(event) => { event.stopPropagation(); previewPointer(event); }}
        onPointerUp={(event) => {
          event.stopPropagation();
          if (gesture.current?.pointerId !== event.pointerId) return;
          previewPointer(event);
          const active = gesture.current;
          gesture.current = null;
          suppressClick.current = active.moved;
          setDragging(false);
          releasePointer(event.pointerId);
          const angle = Math.round(active.rotation);
          if (active.moved && angle !== active.startRotation) onCommit(angle);
        }}
        onPointerCancel={(event) => {
          event.stopPropagation();
          if (gesture.current?.pointerId === event.pointerId) cancelGesture();
        }}
        onLostPointerCapture={(event) => {
          if (gesture.current?.pointerId === event.pointerId) cancelGesture();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            cancelGesture();
            setEditor(null);
            return;
          }
          if (gesture.current) return;
          const direction = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
          if (direction === undefined && event.key !== "Home") return;
          event.preventDefault();
          event.stopPropagation();
          const angle = event.key === "Home" ? 0 : clampRotation(
            (pendingKeyRotation.current ?? rotation) + direction! * (event.shiftKey ? 5 : 1),
          );
          if (angle === (pendingKeyRotation.current ?? rotation)) return;
          pendingKeyRotation.current = angle;
          onPreview(angle);
        }}
        onKeyUp={commitKeys}
        onBlur={commitKeys}
        onClick={(event) => {
          event.stopPropagation();
          if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
          suppressClick.current = false;
          if (editor) { setEditor(null); return; }
          const rect = event.currentTarget.getBoundingClientRect();
          setDraft(String(rotation));
          setEditor({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 192)),
            top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 60)),
          });
        }}
      >
        <RotateCw size={16} aria-hidden="true" />
        <span className="home-photo-angle" aria-hidden="true">{Math.round(rotation)}°</span>
      </button>
      <span id={descriptionId} className="sr-only">
        当前 {Math.round(rotation)}°，范围 −25° 至 25°。拖动旋转，方向键微调 1°，Shift 加方向键调整 5°，Home 恢复水平，Escape 取消拖动。单击可输入角度。
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {dragging ? "" : `照片角度 ${Math.round(rotation)}°`}
      </span>
      {editor && createPortal(
        <form
          id={editorId}
          ref={editorRef}
          className="home-photo-angle-editor"
          style={editor}
          onPointerDown={(event) => event.stopPropagation()}
          onSubmit={(event) => { event.preventDefault(); applyAngle(Number(draft)); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setEditor(null);
              handleRef.current?.focus({ preventScroll: true });
            }
          }}
        >
          <label htmlFor={inputId} className="sr-only">照片旋转角度</label>
          <input
            id={inputId} type="number" min={-HOME_PHOTO_MAX_ROTATION} max={HOME_PHOTO_MAX_ROTATION}
            step={1} required autoFocus value={draft} onChange={(event) => setDraft(event.target.value)}
          />
          <span aria-hidden="true">°</span>
          <button type="submit" aria-label="应用角度" title="应用角度"><Check size={16} /></button>
          <button type="button" aria-label="恢复水平" title="恢复水平" onClick={() => applyAngle(0)}><RotateCcw size={16} /></button>
        </form>, document.body,
      )}
    </>
  );
}
