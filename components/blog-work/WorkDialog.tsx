"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function WorkDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { previous?.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={ref} aria-labelledby={id} className="work-dialog" onCancel={e => { e.preventDefault(); closeRef.current(); }}>
    <header><h2 id={id}>{title}</h2><button type="button" onClick={onClose} aria-label={`关闭${title}`}><X size={20} /></button></header>
    {children}
  </dialog>, document.body);
}
