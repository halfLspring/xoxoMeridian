"use client";

import { useRef, useState } from "react";
import { BaseModal, ModalActions } from "@/components/chat/BaseModal";
import type { HomePhotoElementData } from "@/components/home/types";
import { fitHomePhotoSizeToBounds } from "@/lib/home-spatial";

export function HomeUploadModal({
  isOpen,
  position,
  onClose,
  onUploaded,
}: {
  isOpen: boolean;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onUploaded: (element: HomePhotoElementData) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoSize, setPhotoSize] = useState({ width: 240, height: 180 });
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;

    if (preview) URL.revokeObjectURL(preview);

    const objectUrl = URL.createObjectURL(nextFile);
    setFile(nextFile);
    setPreview(objectUrl);
    setPhotoSize({ width: 240, height: 180 });
    setError("");

    const image = new Image();
    image.onload = () => {
      setPhotoSize(fitHomePhotoSizeToBounds({
        width: image.naturalWidth,
        height: image.naturalHeight,
      }));
    };
    image.onerror = () => {
      setPhotoSize({ width: 240, height: 180 });
    };
    image.src = objectUrl;
  };

  const handleClose = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setCaption("");
    setPhotoSize({ width: 240, height: 180 });
    setError("");
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !position) return;

    setBusy(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("caption", caption);
      formData.append("x", String(position.x));
      formData.append("y", String(position.y));
      formData.append("width", String(photoSize.width));
      formData.append("height", String(photoSize.height));

      const response = await fetch("/api/home-board/uploads", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `Upload failed: ${response.status}`);
      }

      const { element } = await response.json();
      onUploaded(element);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={handleClose} title="添加图片">
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />

        {preview ? (
          <div className="relative">
            {/* Blob previews are local-only and must bypass the Next image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Preview"
              className="w-full rounded-[8px] bg-[#f6f8f4] object-contain"
              style={{ maxHeight: 240 }}
            />
            <button
              type="button"
              className="absolute right-2 top-2 rounded-[6px] bg-black/40 px-2 py-0.5 text-xs text-white transition-colors duration-200 hover:bg-black/60 cursor-pointer"
              onClick={() => {
                URL.revokeObjectURL(preview);
                setFile(null);
                setPreview(null);
              }}
            >
              重选
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-32 w-full items-center justify-center rounded-[10px] border-2 border-dashed border-[#d9d9d9] bg-[#fafbfc] text-sm text-black/40 transition-colors duration-200 hover:border-[#3a5b22] hover:text-[#3a5b22] cursor-pointer"
          >
            点击选择图片（JPG / PNG / WebP，≤5MB）
          </button>
        )}

        <div>
          <label className="text-sm font-medium text-black/70">标注（可选）</label>
          <input
            type="text"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            maxLength={200}
            className="mt-1 w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] leading-normal outline-hidden transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15"
            placeholder="给图片添加一行标注…"
          />
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700">
            {error}
          </p>
        )}

        <ModalActions
          busy={busy}
          onCancel={handleClose}
          submitLabel="上传"
          busyLabel="上传中…"
        />
      </form>
    </BaseModal>
  );
}
