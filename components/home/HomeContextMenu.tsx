"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBlogActions } from "@/components/blog-work/BlogActionProvider";
import { FilePenLine } from "lucide-react";
import { CameraIcon } from "@/components/icons";
import type { HomeContextMenuState } from "@/components/home/types";

export function HomeContextMenu({
  state,
  onAddPhoto,
}: {
  state: HomeContextMenuState;
  onAddPhoto: () => void;
}) {
  const blogActions = useBlogActions();
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: state.screenX, top: state.screenY });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(state.screenX, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(state.screenY, window.innerHeight - height - 8)),
    });
    buttonRef.current?.focus({ preventScroll: true });
  }, [state.screenX, state.screenY]);

  return createPortal(
    <div
      ref={menuRef}
      data-home-context-menu
      className="fixed z-50 min-w-[150px] overflow-hidden rounded-[10px] bg-white shadow-lg"
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        ref={buttonRef}
        type="button"
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-black/70 transition-colors duration-200 hover:bg-sage-50 focus-visible:bg-sage-50 focus-visible:outline-hidden cursor-pointer"
        onClick={onAddPhoto}
      >
        <CameraIcon size={16} />
        添加图片
      </button>
      <button type="button" className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-black/70 hover:bg-sage-50" onClick={() => blogActions?.requestAction("new")}><FilePenLine size={16} />新增草稿</button>
    </div>,
    document.body,
  );
}
