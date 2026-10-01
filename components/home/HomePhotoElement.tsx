"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { HomePhotoRotation } from "@/components/home/HomePhotoRotation";
import type { HomePhotoElementData } from "@/components/home/types";
import { clampPhotoSize } from "@/lib/home-spatial";

export function HomePhotoElement({
  element,
  viewScale = 1,
  readOnly = false,
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

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (deleting || readOnly || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-caption-area], [data-rotation-control]") || target.closest("button")) return;

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      ...dragRef.current,
      active: true,
      resizing: false,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: element.x,
      startY: element.y,
      downTime: Date.now(),
    };
  }, [deleting, readOnly, element.x, element.y]);

  const onResizePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (deleting) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      ...dragRef.current,
      active: true,
      resizing: true,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: element.width,
      startRotation: element.rotation,
      aspectRatio: element.width / Math.max(element.height, 1),
    };
  }, [deleting, element.width, element.height, element.rotation]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (deleting || !dragRef.current.active || dragRef.current.resizing) return;
    const dx = (event.clientX - dragRef.current.startClientX) / viewScale;
    const dy = (event.clientY - dragRef.current.startClientY) / viewScale;
    onMove(element.id, dragRef.current.startX + dx, dragRef.current.startY + dy);
  }, [deleting, element.id, onMove, viewScale]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (deleting || !dragRef.current.active || dragRef.current.resizing) return;
    dragRef.current.active = false;
    const dx = (event.clientX - dragRef.current.startClientX) / viewScale;
    const dy = (event.clientY - dragRef.current.startClientY) / viewScale;
    const dist = Math.hypot(dx, dy);
    const duration = Date.now() - dragRef.current.downTime;

    if (dist < 5 && duration < 300) {
      onSelect(element.id);
      return;
    }

    onMoveEnd(element.id, dragRef.current.startX + dx, dragRef.current.startY + dy);
  }, [deleting, element.id, onMoveEnd, onSelect, viewScale]);

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
    if (deleting || !dragRef.current.active || !dragRef.current.resizing) return;
    const size = getResizeSize(event.clientX, event.clientY);
    rootRef.current?.style.setProperty("--home-photo-width", `${size.width}px`);
    rootRef.current?.style.setProperty("--home-photo-height", `${size.height}px`);
    onResizePreview?.(element.id, size.width, size.height);
  }, [deleting, getResizeSize, element.id, onResizePreview]);

  const onResizePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (deleting || !dragRef.current.active || !dragRef.current.resizing) return;
    dragRef.current.active = false;
    dragRef.current.resizing = false;
    const size = getResizeSize(event.clientX, event.clientY);
    onResizeEnd(element.id, size.width, size.height);
  }, [deleting, element.id, getResizeSize, onResizeEnd]);

  const cancelGesture = useCallback(() => {
    const drag = dragRef.current;
    if (!drag.active) return;
    if (drag.resizing) {
      rootRef.current?.style.setProperty("--home-photo-width", `${drag.startWidth}px`);
      rootRef.current?.style.setProperty("--home-photo-height", `${drag.startWidth / drag.aspectRatio}px`);
      onResizePreview?.(element.id, drag.startWidth, drag.startWidth / drag.aspectRatio);
    } else onMove(element.id, drag.startX, drag.startY);
    drag.active = false;
    drag.resizing = false;
  }, [element.id, onMove, onResizePreview]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") cancelGesture(); };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [cancelGesture]);

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
      onPointerCancel={cancelGesture}
      onLostPointerCapture={cancelGesture}
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
                className="w-full bg-transparent text-xs text-black/60 outline-none"
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
