"use client";

import { useEffect, useRef } from "react";

export function PostCardSpatialShell({
  elementId,
  label = "连接博文",
  isConnectFrom,
  onSpatialClick,
  registerSpatialAnchor,
  children,
}: {
  elementId?: string;
  label?: string;
  isConnectFrom: boolean;
  onSpatialClick?: (elementId: string) => void;
  registerSpatialAnchor?: (elementId: string, getRect: () => DOMRect | null) => () => void;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!elementId || !registerSpatialAnchor) return;
    return registerSpatialAnchor(elementId, () => rootRef.current?.getBoundingClientRect() ?? null);
  }, [elementId, registerSpatialAnchor]);

  return (
    <div
      ref={rootRef}
      data-home-post-card={registerSpatialAnchor ? "" : undefined}
      className={`relative z-20 max-w-sm w-full ${isConnectFrom ? "home-connect-from" : ""}`}
      onClick={(event) => {
        if (!elementId || !onSpatialClick) return;
        const target = event.target as HTMLElement;
        if (target.closest("a") || target.closest("button")) return;
        onSpatialClick(elementId);
      }}
    >
      {children}
      {elementId && onSpatialClick && <button type="button" className="canvas-post-connect sr-only focus:not-sr-only" aria-label={label} aria-pressed={isConnectFrom} onClick={() => onSpatialClick(elementId)}>连接</button>}
    </div>
  );
}
