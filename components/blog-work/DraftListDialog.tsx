"use client";
import { useCallback, useEffect, useState } from "react";
import { WorkDialog } from "@/components/blog-work/WorkDialog";
import type { DraftSummary } from "@/lib/blog-work/types";
import { formatPostTimestamp } from "@/lib/post-time";
export function DraftListDialog({ actorId, onOpen, onClose }: { actorId: string; onOpen: (id: string) => void; onClose: () => void }) {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]), [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const load = useCallback(async (next?: string, signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/blog/works${next ? `?cursor=${encodeURIComponent(next)}` : ""}`, { headers: { "X-Blog-Viewer-Id": actorId }, signal, cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json(); if (signal?.aborted) return;
      setDrafts(previous => next ? [...previous, ...data.drafts] : data.drafts); setCursor(data.nextCursor); setError("");
    } catch { if (!signal?.aborted) setError("草稿列表读取失败，请重试"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [actorId]);
  useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => { if (!controller.signal.aborted) return load(undefined, controller.signal); }); return () => controller.abort(); }, [load]);
  return <WorkDialog title="My Draft" onClose={onClose}>
    {loading && <p role="status">正在读取草稿…</p>}{error && <p role="alert">{error}<button onClick={() => { setLoading(true); void load(); }}>重试读取草稿</button></p>}
    {!loading && !error && !drafts.length && <p>还没有草稿，在 Blog 空白处右键选择“新增草稿”开始记录。</p>}
    <ul className="draft-list">{drafts.map(draft => <li key={draft.id}><button className="draft-list-open" onClick={() => onOpen(draft.id)}>
      {/* 私密缩略图直接使用当前 Cookie。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {draft.thumbnail && <img src={draft.thumbnail} alt="" />}<span><strong>{draft.title}</strong><time dateTime={draft.updatedAt}>{formatPostTimestamp(new Date(draft.updatedAt), { timezone: draft.authorTimezone })}</time></span></button>
      <button aria-label={`删除草稿：${draft.title}`} onClick={async () => { if (!window.confirm("删除这份草稿及其全部图文和连线？")) return; const response = await fetch(`/api/blog/works/${draft.id}`, { method: "DELETE", headers: { "Content-Type": "application/json", "X-Blog-Viewer-Id": actorId }, body: JSON.stringify({ mutationId: crypto.randomUUID(), baseRevision: draft.revision, expectedStatus: "draft" }) }); if (response.ok) setDrafts(ds => ds.filter(d => d.id !== draft.id)); else setError("删除失败，请刷新列表后重试"); }}>删除</button></li>)}</ul>
    {cursor && <button disabled={loading} onClick={() => { setLoading(true); void load(cursor); }}>更多草稿</button>}
  </WorkDialog>;
}
