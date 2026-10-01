"use client";
import { useEffect, useState } from "react";
import { WorkDialog } from "@/components/blog-work/WorkDialog";
import type { WorkSnapshot } from "@/lib/blog-work/types";
type Target = { id: string; name: string; kind: string; workId: string | null };
export function WorkConnectionPicker({ work, actorId, onConnect, onDelete, onClose }: { work: WorkSnapshot; actorId: string; onConnect: (fromId: string, toId: string) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState(""), [targets, setTargets] = useState<Target[]>([]), [error, setError] = useState("");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/blog/works/${work.id}/targets?q=${encodeURIComponent(q)}`, { headers: { "X-Blog-Viewer-Id": actorId }, signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json(); if (!abort.signal.aborted) { setTargets(data.targets); setError(""); }
    }).catch(() => { if (!abort.signal.aborted) setError("目标读取失败，请重新搜索"); });
    return () => abort.abort();
  }, [q, actorId, work.id]);
  return <WorkDialog title="连线" onClose={onClose}>
    <p className="work-help">选择作品内起点和可见图文终点。草稿中的外部连线发布前仅自己可见。</p>
    <label htmlFor="work-target-search">搜索公开目标</label><input id="work-target-search" value={q} onChange={e => setQ(e.target.value)} />
    {error && <p role="alert">{error}</p>}
    <label htmlFor="work-source">起点</label><select id="work-source" value={from} onChange={e => setFrom(e.target.value)}><option value="">选择作品内元素</option>{work.elements.map(e => <option key={e.id} value={e.id}>{work.posts.find(p => p.elementId === e.id)?.title || e.caption || (e.type === "photo" ? "未标注图片" : "未命名博文")}</option>)}</select>
    <label htmlFor="work-target">终点</label><select id="work-target" value={to} onChange={e => setTo(e.target.value)}><option value="">选择图文目标</option>{targets.filter(t => t.id !== from).map(t => <option key={t.id} value={t.id}>{t.name}{t.workId === work.id ? "（本作品）" : "（公开）"}</option>)}</select>
    <button className="work-primary" disabled={!from || !to} onClick={() => onConnect(from, to)}>添加连线</button>
    <ul className="work-connection-list">{work.connections.filter(c => c.workId === work.id).map((c, index) => <li key={c.id}>连线 {index + 1}<button onClick={() => onDelete(c.id)} aria-label={`删除作品连线 ${index + 1}`}>删除</button></li>)}</ul>
  </WorkDialog>;
}
