"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPost, updatePost, deletePost } from "@/app/actions/posts";

type PostEditorProps = {
  initialValues?: { title: string; content: string; slug: string };
};

export function PostEditor({ initialValues }: PostEditorProps) {
  const router = useRouter();
  const isEditing = !!initialValues;
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [content, setContent] = useState(initialValues?.content ?? "");
  const [error, setError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isBusy = isPending || isSubmitting;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (isBusy) return;
    setError("");
    setIsSubmitting(true);

    void (async () => {
      try {
        const result = isEditing
          ? await updatePost(initialValues!.slug, title, content)
          : await createPost(title, content);

        if ("error" in result) {
          setError(result.error);
          return;
        }

        startTransition(() => {
          router.push(`/posts/${result.post.slug}`);
        });
      } finally {
        setIsSubmitting(false);
      }
    })();
  }

  function handleDelete() {
    if (isBusy || !initialValues) return;
    setIsSubmitting(true);

    void (async () => {
      try {
        const result = await deletePost(initialValues.slug);

        if ("error" in result) {
          setError(result.error);
          return;
        }

        startTransition(() => {
          router.push("/home");
        });
      } finally {
        setIsSubmitting(false);
      }
    })();
  }

  return (
    <div className="max-w-2xl mx-auto">
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="space-y-6">
        <label htmlFor="post-title" className="sr-only">Post title</label>
        <input
          id="post-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Post title"
          required
          disabled={isBusy}
          className="w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-lg font-semibold text-black placeholder:text-black/30 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-none disabled:opacity-50"
        />

        <label htmlFor="post-content" className="sr-only">Post content</label>
        <textarea
          id="post-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write your post in Markdown..."
          required
          disabled={isBusy}
          rows={20}
          className="w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] leading-relaxed text-black placeholder:text-black/30 font-mono resize-y focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-none disabled:opacity-50"
        />

        <div className="flex items-center justify-between">
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isBusy}
              className="rounded-[10px] bg-[#3a5b22] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#2e4a1a] transition-colors disabled:opacity-50"
            >
              {isBusy ? "Saving..." : isEditing ? "Update" : "Publish"}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              disabled={isBusy}
              className="rounded-[10px] border border-[#d9d9d9] bg-white px-6 py-2.5 text-sm text-black/60 hover:bg-neutral-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>

          {isEditing && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isBusy}
              className="rounded-[10px] border border-red-200 bg-white px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </form>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-[10px] p-6 shadow-soft max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-black mb-4">Are you sure you want to delete this post?</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isBusy}
                className="rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-2 text-sm text-black/60 hover:bg-neutral-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isBusy}
                className="rounded-[10px] bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
