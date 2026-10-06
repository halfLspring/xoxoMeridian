"use client";

import { useCallback, useEffect, useRef } from "react";

type BaseModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

export function BaseModal({ isOpen, onClose, title, children }: BaseModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-[10px] bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-black">{title}</h2>
        {children}
      </div>
    </div>
  );
}

type ModalActionsProps = {
  busy: boolean;
  onCancel: () => void;
  submitLabel?: string;
  busyLabel?: string;
};

export function ModalActions({
  busy,
  onCancel,
  submitLabel = "保存",
  busyLabel = "保存中…",
}: ModalActionsProps) {
  return (
    <div className="flex gap-2 pt-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="flex-1 rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-2.5 text-sm font-medium text-black/60 transition-colors duration-200 hover:bg-neutral-50 focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden disabled:opacity-50 cursor-pointer"
      >
        取消
      </button>
      <button
        type="submit"
        disabled={busy}
        className="flex-1 rounded-[10px] bg-[#3a5b22] px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#2e4a1a] focus:ring-2 focus:ring-[#3a5b22]/30 focus:outline-hidden disabled:opacity-50 cursor-pointer"
      >
        {busy ? busyLabel : submitLabel}
      </button>
    </div>
  );
}
