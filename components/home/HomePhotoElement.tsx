"use client";

import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { HomePhotoRotation } from "@/components/home/HomePhotoRotation";
import type { HomePhotoElementData } from "@/components/home/types";
import { clampPhotoSize } from "@/lib/home-spatial";

export function HomePhotoElement({
  element,
  viewScale = 1,
  readOnly = false,
  connectable = !readOnly,
  onResizePreview,
  deleting,
  selected,
  onSelect,
  onMove,
  onMoveEnd,
  onResizeEnd,
  onRotate,
  onRotateEnd,
  onCaption,
  onDelete,
  registerAnchor,
}: {
  element: HomePhotoElementData;
  viewScale?: number;
  readOnly?: boolean;
  connectable?: boolean;
  onResizePreview?: (id: string, width: number, height: number) => void;
  deleting: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onMoveEnd: (id: string, x: number, y: number) => void;
  onResizeEnd: (id: string, width: number, height: number) => void;
  onRotate: (id: string, rotation: number) => void;
  onRotateEnd: (id: string, rotation: number) => void;
  onCaption: (id: string, caption: string) => void;
  onDelete: (id: string) => void;
  registerAnchor: (id: string, getRect: () => DOMRect | null) => () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const captionInputId = useId();
  const [caption, setCaption] = useState(element.caption ?? "");
  const [editingCaption, setEditingCaption] = useState(false);
  const dragRef = useRef({
    active: false,
    resizing: false,
    moved: false,
    pointerId: null as number | null,
    target: null as HTMLElement | null,
    startClientX: 0,
    startClientY: 0,
    startX: element.x,
    startY: element.y,
    startWidth: element.width,
    startRotation: element.rotation,
    aspectRatio: element.width / Math.max(element.height, 1),
    downTime: 0,
  });

  useEffect(() => {
    return registerAnchor(element.id, () => rootRef.current?.getBoundingClientRect() ?? null);
  }, [element.id, registerAnchor]);

  const commitCaption = () => {
    setEditingCaption(false);
    if (deleting) return;
    if (caption !== (element.caption ?? "")) {
      onCaption(element.id, caption);
    }
  };

  const finishGesture = useCallback(() => {
    const drag = dragRef.current;
    const { pointerId, target } = drag;
    drag.active = false;
    drag.resizing = false;
    drag.pointerId = null;
    drag.target = null;
    if (pointerId !== null && target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (deleting || (readOnly && !connectable) || event.button !== 0 || event.isPrimary === false || dragRef.current.active) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-caption-area], [data-rotation-control]") || (target.closest("button") && !target.closest("[data-connection-endpoint]"))) return;

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      ...dragRef.current,
      active: true,
      resizing: false,
      moved: false,
      pointerId: event.pointerId,
      target: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: element.x,
      startY: element.y,
      downTime: Date.now(),
    };
  }, [deleting, readOnly, connectable, element.x, element.y]);

  const onResizePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (deleting || readOnly || event.button !== 0 || event.isPrimary === false || dragRef.current.active) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      ...dragRef.current,
      active: true,
      resizing: true,
      pointerId: event.pointerId,
      target: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: element.width,
      startRotation: element.rotation,
      aspectRatio: element.width / Math.max(element.height, 1),
    };
  }, [deleting, readOnly, element.width, element.height, element.rotation]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (deleting || !dragRef.current.active || dragRef.current.resizing || dragRef.current.pointerId !== event.pointerId) return;
    const dx = (event.clientX - dragRef.current.startClientX) / viewScale;
    const dy = (event.clientY - dragRef.current.startClientY) / viewScale;
    if (Math.hypot(dx, dy) >= 5) dragRef.current.moved = true;
    if (dragRef.current.moved && !readOnly) onMove(element.id, dragRef.current.startX + dx, dragRef.current.startY + dy);
  }, [deleting, readOnly, element.id, onMove, viewScale]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (deleting || !dragRef.current.active || dragRef.current.resizing || dragRef.current.pointerId !== event.pointerId) return;
    finishGesture();
    const dx = (event.clientX - dragRef.current.startClientX) / viewScale;
    const dy = (event.clientY - dragRef.current.startClientY) / viewScale;
    const dist = Math.hypot(dx, dy);
    const duration = Date.now() - dragRef.current.downTime;

    if (!dragRef.current.moved && dist < 5 && duration < 300) {
      if (connectable) onSelect(element.id);
      return;
    }

    if (!readOnly) onMoveEnd(element.id, dragRef.current.startX + dx, dragRef.current.startY + dy);
  }, [deleting, readOnly, connectable, element.id, onMoveEnd, onSelect, viewScale, finishGesture]);

  const getResizeSize = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    const radians = drag.startRotation * Math.PI / 180;
    const dx = (clientX - drag.startClientX) / viewScale;
    const dy = (clientY - drag.startClientY) / viewScale;
    return clampPhotoSize({
      width: drag.startWidth + dx * Math.cos(radians) + dy * Math.sin(radians),
      aspectRatio: drag.aspectRatio,
    });
  }, [viewScale]);

  const onResizePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (deleting || !dragRef.current.active || !dragRef.current.resizing || dragRef.current.pointerId !== event.pointerId) return;
    const size = getResizeSize(event.clientX, event.clientY);
    rootRef.current?.style.setProperty("--home-photo-width", `${size.width}px`);
    rootRef.current?.style.setProperty("--home-photo-height", `${size.height}px`);
    onResizePreview?.(element.id, size.width, size.height);
  }, [deleting, getResizeSize, element.id, onResizePreview]);

  const onResizePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (deleting || !dragRef.current.active || !dragRef.current.resizing || dragRef.current.pointerId !== event.pointerId) return;
    const size = getResizeSize(event.clientX, event.clientY);
    finishGesture();
    onResizeEnd(element.id, size.width, size.height);
  }, [deleting, element.id, getResizeSize, onResizeEnd, finishGesture]);

  const cancelGesture = useCallback(() => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const resizing = drag.resizing;
    finishGesture();
    if (resizing) {
      rootRef.current?.style.setProperty("--home-photo-width", `${drag.startWidth}px`);
      rootRef.current?.style.setProperty("--home-photo-height", `${drag.startWidth / drag.aspectRatio}px`);
      onResizePreview?.(element.id, drag.startWidth, drag.startWidth / drag.aspectRatio);
    } else if (!readOnly) onMove(element.id, drag.startX, drag.startY);
  }, [element.id, readOnly, onMove, onResizePreview, finishGesture]);
  const cancelPointerGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId === event.pointerId) cancelGesture();
  };
  const cancelFromKey = useEffectEvent(cancelGesture);
  useEffect(() => {
    // 同一次 keydown 中较早的监听器可能触发重渲染；稳定订阅避免新监听器错过当前 Escape。
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") cancelFromKey(); };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);

  return (
    <div
      ref={rootRef}
      data-home-photo
      data-element-id={element.id}
      aria-busy={deleting}
      className={`home-photo-element absolute select-none ${selected ? "is-selected" : ""}`}
      style={{
        left: element.x,
        top: element.y,
        width: "var(--home-photo-width)",
        height: "var(--home-photo-height)",
        ["--home-photo-width" as string]: `${element.width}px`,
        ["--home-photo-height" as string]: `${element.height}px`,
        transform: `rotate(${element.rotation}deg)`,
        transformOrigin: "center center",
        touchAction: readOnly ? undefined : "none",
      }}
      onPointerCancel={cancelPointerGesture}
      onLostPointerCapture={cancelPointerGesture}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="home-photo-card">
        {/* Private storage URLs require the browser session cookie and cannot use the image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={element.imageUrl}
          alt={element.caption ?? ""}
          className="pointer-events-none h-full w-full rounded-[8px] bg-[#f6f8f4] object-contain"
          draggable={false}
        />

        {connectable && <button type="button" data-connection-endpoint className="canvas-photo-connect"
          aria-label={`连接照片：${element.caption || "未标注照片"}`} aria-pressed={selected} disabled={deleting}
          onClick={event => { if (event.detail === 0 && !deleting) { event.stopPropagation(); onSelect(element.id); } }} />}

        <div className="home-photo-caption" data-caption-area>
          {readOnly ? <span>{element.caption}</span> : editingCaption ? (
            <>
              <label htmlFor={captionInputId} className="sr-only">照片标注</label>
              <input
                id={captionInputId}
                disabled={deleting}
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                onBlur={commitCaption}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "Escape") commitCaption();
                }}
                className="w-full bg-transparent text-xs text-black/60 outline-hidden"
                data-caption-area
                autoFocus
                maxLength={200}
              />
            </>
          ) : (
            <button
              type="button"
              disabled={deleting}
              className="block w-full truncate text-left text-xs text-black/45 cursor-text"
              data-caption-area
              onClick={(event) => {
                event.stopPropagation();
                setCaption(element.caption ?? "");
                setEditingCaption(true);
              }}
            >
              {element.caption || "添加标注…"}
            </button>
          )}
        </div>

        {!readOnly && <>
        <button
          type="button"
          className="home-photo-delete"
          aria-label={`删除照片：${element.caption || "未标注照片"}`}
          disabled={deleting}
          onClick={(event) => {
            event.stopPropagation();
            onDelete(element.id);
          }}
          title="删除"
        >
          &times;
        </button>

        <HomePhotoRotation
          photoRef={rootRef}
          rotation={element.rotation}
          caption={element.caption || "未标注照片"}
          disabled={deleting}
          onPreview={(rotation) => onRotate(element.id, rotation)}
          onCommit={(rotation) => onRotateEnd(element.id, rotation)}
        />

        <button
          type="button"
          className="home-photo-resize"
          aria-label={`调整照片大小：${element.caption || "未标注照片"}`}
          disabled={deleting}
          onKeyDown={(event) => {
            const step = { ArrowLeft: -10, ArrowDown: -10, ArrowRight: 10, ArrowUp: 10 }[event.key];
            if (step === undefined) return;
            event.preventDefault();
            event.stopPropagation();
            const size = clampPhotoSize({ width: element.width + step, aspectRatio: element.width / Math.max(element.height, 1) });
            onResizeEnd(element.id, size.width, size.height);
          }}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          title="调整大小"
        />
        </>}
      </div>
    </div>
  );
}
