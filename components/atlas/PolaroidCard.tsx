"use client";

import { useState } from "react";
import type { AtlasElementData } from "@/components/atlas/types";

export function PolaroidCard({
  element,
  onUpdate,
  onDelete,
}: {
  element: AtlasElementData;
  onUpdate: (id: string, patch: Partial<AtlasElementData>) => void;
  onDelete: (id: string) => void;
}) {
  const [editingCaption, setEditingCaption] = useState(false);
  const [caption, setCaption] = useState(element.caption ?? "");

  const commitCaption = () => {
    setEditingCaption(false);
    if (caption !== (element.caption ?? "")) {
      onUpdate(element.id, { caption });
    }
  };

  return (
    <div className="relative rounded-[6px] bg-white p-2 pb-10 shadow-md" style={{ minWidth: 160 }}>
      {element.imageUrl ? (
        // Private storage URLs require the browser session cookie and cannot use the image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={element.imageUrl}
          alt={element.caption ?? ""}
          className="pointer-events-none w-full rounded-[4px] object-cover"
          style={{ aspectRatio: "4/3" }}
          draggable={false}
        />
      ) : (
        <div
          className="flex w-full items-center justify-center rounded-[4px] bg-warm-100 text-black/20"
          style={{ aspectRatio: "4/3" }}
        >
          <span className="text-2xl">+</span>
        </div>
      )}

      {/* Caption area in Polaroid bottom */}
      <div className="absolute bottom-1.5 left-2 right-6" data-caption-area>
        {editingCaption ? (
          <input
            className="w-full bg-transparent text-xs text-black/60 outline-hidden"
            data-caption-area
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={commitCaption}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") commitCaption();
            }}
            autoFocus
            maxLength={200}
          />
        ) : (
          <p
            className="truncate text-xs text-black/50 cursor-text"
            data-caption-area
            onClick={(e) => {
              e.stopPropagation();
              setEditingCaption(true);
            }}
          >
            {element.caption || <span className="italic text-black/20">添加备注…</span>}
          </p>
        )}
      </div>

      <button
        type="button"
        className="absolute right-1 top-1 rounded-[4px] p-0.5 text-[10px] text-black/30 transition-colors duration-200 hover:bg-red-100 hover:text-red-500 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(element.id);
        }}
        title="删除"
      >
        &times;
      </button>
    </div>
  );
}
