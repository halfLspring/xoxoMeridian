"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Clock3 } from "lucide-react";
import { formatPostTimestamp } from "@/lib/post-time";

export function WorkPublishedTime({ anchorRef, ownerName, publishedAt, timezone }: {
  anchorRef: RefObject<HTMLElement | null>;
  ownerName: string;
  publishedAt: string;
  timezone?: string | null;
}) {
  const id = useId(), popup = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const active = useRef({ frame: false, popup: false, keyboard: false, touch: false });
  const pointerType = useRef("");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const show = useCallback(() => { clearClose(); setOpen(true); }, [clearClose]);
  const dismiss = useCallback(() => {
    clearClose();
    active.current.keyboard = false;
    active.current.touch = false;
    active.current.popup = false;
    setOpen(false);
  }, [clearClose]);
  const closeAfterLeave = useCallback(() => {
    clearClose();
    // 跨过边框与浮层间的空隙时保留阅读机会，不铺设会遮挡缩放手柄的透明命中层。
    closeTimer.current = setTimeout(() => {
      if (!Object.values(active.current).some(Boolean)) setOpen(false);
    }, 180);
  }, [clearClose]);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const enter = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      active.current.frame = true;
      show();
    };
    const leave = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      active.current.frame = false;
      closeAfterLeave();
    };
    anchor.addEventListener("pointerenter", enter);
    anchor.addEventListener("pointerleave", leave);
    return () => {
      anchor.removeEventListener("pointerenter", enter);
      anchor.removeEventListener("pointerleave", leave);
      clearClose();
    };
  }, [anchorRef, show, closeAfterLeave, clearClose]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    const pointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // 开始编辑、拖动或点按其它位置即关闭；浮层不截获任何画布手势。
      if (!trigger.current?.contains(target) && !popup.current?.contains(target)) dismiss();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", pointerDown, true);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", pointerDown, true);
    };
  }, [open, dismiss]);

  useLayoutEffect(() => {
    if (!open) return;
    let animationFrame = 0;
    const place = () => {
      const anchor = anchorRef.current, element = popup.current;
      if (!anchor || !element) return;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8, topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height ?? innerHeight) - 16;
      element.style.maxWidth = `${rightEdge - leftEdge}px`;
      element.style.maxHeight = `${bottomEdge - topEdge}px`;
      const frame = anchor.getBoundingClientRect(), box = element.getBoundingClientRect();
      const left = Math.max(leftEdge, Math.min(frame.left, rightEdge - box.width));
      let top = frame.top - box.height - 16;
      if (top < topEdge) top = frame.bottom + 16;
      // 上下均无完整空位时，优先保证文字仍在可视区域内。
      top = Math.max(topEdge, Math.min(top, bottomEdge - box.height));
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.style.visibility = frame.bottom < topEdge || frame.top > bottomEdge || frame.right < leftEdge || frame.left > rightEdge ? "hidden" : "visible";
      // 只在阅读浮层时跟随滚动、缩放、动画及相邻作品布局变化；关闭后释放。
      animationFrame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(animationFrame);
  }, [open, anchorRef]);

  return <>
    <button ref={trigger} type="button" aria-label="查看作品发布时间" aria-describedby={open ? id : undefined}
      onPointerDown={event => { pointerType.current = event.pointerType; }}
      onFocus={event => {
        if (event.currentTarget.matches(":focus-visible")) { active.current.keyboard = true; show(); }
      }}
      onBlur={() => { active.current.keyboard = false; closeAfterLeave(); }}
      onClick={event => {
        if (event.detail !== 0 && pointerType.current === "touch") {
          active.current.touch = !active.current.touch;
          if (active.current.touch) show(); else dismiss();
        } else show();
      }}><Clock3 size={17} aria-hidden="true" /></button>
    {open && createPortal(<div ref={popup} id={id} role="tooltip" aria-label="作品发布时间" className="work-published-time"
      onPointerEnter={() => { active.current.popup = true; clearClose(); }}
      onPointerLeave={() => { active.current.popup = false; closeAfterLeave(); }}>
      {ownerName} · <time dateTime={publishedAt}>{formatPostTimestamp(new Date(publishedAt), { timezone, dateOnly: true })}</time>
    </div>, document.body)}
  </>;
}
