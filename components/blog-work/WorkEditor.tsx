"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import Link from "next/link";
import { FilePenLine, ImagePlus, Link2, LockKeyhole } from "lucide-react";
import { useWorkMutations } from "@/components/blog-work/useWorkMutations";
import { WorkCanvas, type AnchorRegistrar } from "@/components/blog-work/WorkCanvas";
import { WorkFrame, type WorkFrameValue } from "@/components/blog-work/WorkFrame";
import { WorkDialog } from "@/components/blog-work/WorkDialog";
import { WorkPostForm } from "@/components/blog-work/WorkPostForm";
import { WorkConnectionPicker } from "@/components/blog-work/WorkConnectionPicker";
import { MarkdownContent } from "@/components/blog/MarkdownContent";
import { fitHomePhotoSizeToBounds } from "@/lib/home-spatial";
import { photoPatchSchema, type WorkWindow } from "@/lib/blog-work/schemas";
import type { WorkSnapshot, WorkElement } from "@/lib/blog-work/types";
import { formatPostTimestamp } from "@/lib/post-time";

export type LeaveHandler = (next: () => void) => void;
const onlyWindow = (w: WorkWindow): WorkWindow => ({ viewportX: w.viewportX, viewportY: w.viewportY, viewportWidth: w.viewportWidth, viewportHeight: w.viewportHeight });
type TextBuffer = { title: string; content: string; version: number };
const photoChanged = (work: WorkSnapshot, id: string, patch: Partial<WorkElement>) => {
  const stored = work.elements.find(element => element.id === id);
  return !!stored && (Object.keys(patch) as Array<keyof WorkElement>).some(key => patch[key] !== stored[key]);
};
export function WorkEditor({ initial, actorId, editable = false, focusPostId, leaveRef, onClose, onPublished, onDeleted, onChanged, registerAnchor }: {
  initial: WorkSnapshot; actorId: string; editable?: boolean; focusPostId?: string; leaveRef?: MutableRefObject<LeaveHandler | null>;
  onClose: () => void; onPublished: (work: WorkSnapshot) => void; onDeleted: (id: string) => void; onChanged?: (work: WorkSnapshot) => void; registerAnchor?: AnchorRegistrar;
}) {
  const save = useWorkMutations(initial, actorId), { work, state, enqueue, refresh } = save;
  const [editing, setEditing] = useState(editable || initial.status === "draft"), [modal, setModal] = useState<string | null>(focusPostId && initial.posts.some(p => p.id === focusPostId) ? `post:${focusPostId}` : null);
  const textVersion = useRef(0), sentVersions = useRef(new Map<string, number>());
  const [texts, setTexts] = useState<Record<string, TextBuffer>>({}), textRef = useRef(texts), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [photoPatches, setPhotoPatches] = useState<Record<string, Partial<WorkElement>>>({}), [frame, setFrame] = useState<WorkFrameValue | null>(null);
  const [framePreview, setFramePreview] = useState<WorkFrameValue | null>(null);
  const [scale, setScale] = useState(1), root = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(initial.viewportWidth);
  const [availableLeft, setAvailableLeft] = useState(0);
  const header = useRef<HTMLElement>(null), footer = useRef<HTMLElement>(null);
  const [controlsSize, setControlsSize] = useState({ header: 0, footer: 0 });
  const viewportWidth = useRef(initial.viewportWidth);
  const [selected, setSelected] = useState<string | null>(null), [localError, setLocalError] = useState("");
  const [leaving, setLeaving] = useState(false), pendingLeave = useRef<(() => void) | null>(null), [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirtyText = Object.keys(texts).length > 0;
  const dirtyPhotos = Object.entries(photoPatches).some(([id, patch]) => photoChanged(work, id, patch));
  const dirtyFrame = !!framePreview || (!!frame && (["viewportX", "viewportY", "viewportWidth", "viewportHeight", "draftX", "draftY"] as const).some(key => frame[key] !== work[key]));
  const busy = state !== "clean" || dirtyText || dirtyPhotos || dirtyFrame || uploading || publishing || deleting;
  const locked = leaving || publishing || deleting;
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    for (const [id, buffer] of Object.entries(textRef.current)) {
      const { title, content, version } = buffer;
      if (sentVersions.current.get(id) === version) continue;
      sentVersions.current.set(id, version);
      // 只确认本次发送的缓冲版本，较晚输入不会被旧响应覆盖。
      void enqueue({ operation: "post.update", id, data: { title, content } }).then(result => {
        if (!result) return;
        setTexts(previous => { if (previous[id]?.version !== version) return previous; const next = { ...previous }; delete next[id]; textRef.current = next; return next; });
      });
    }
  }, [enqueue]);
  const requestLeave = useCallback((next: () => void) => {
    if (deleting) return;
    if (work.status === "published" && Object.keys(textRef.current).length && !window.confirm("保存并公开博文修改后离开？")) return;
    pendingLeave.current = next;
    if (!save.isClean() || Object.keys(textRef.current).length || uploading || dirtyFrame) { setLeaving(true); flush(); }
    else { pendingLeave.current = null; next(); }
  }, [save, flush, uploading, dirtyFrame, work.status, deleting]);
  useEffect(() => { if (leaveRef) leaveRef.current = requestLeave; return () => { if (leaveRef) leaveRef.current = null; }; }, [leaveRef, requestLeave]);
  useEffect(() => {
    if (leaving && !busy && pendingLeave.current) {
      const next = pendingLeave.current; pendingLeave.current = null;
      // 保存完成后入口意图可能已经取消；先解除等待，留下的原编辑器仍应可操作。
      setLeaving(false);
      next();
    }
  }, [leaving, busy]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (busy) { event.preventDefault(); event.returnValue = ""; } };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      if (!anchor || event.ctrlKey || event.metaKey || anchor.target === "_blank" || !busy) return;
      event.preventDefault(); event.stopPropagation(); requestLeave(() => { window.location.href = anchor.href; });
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigate, true); };
  }, [busy, uploading, requestLeave]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);
  useLayoutEffect(() => { viewportWidth.current = framePreview?.viewportWidth ?? frame?.viewportWidth ?? work.viewportWidth; }, [framePreview?.viewportWidth, frame?.viewportWidth, work.viewportWidth]);
  // 可用宽度来自不随裁切框变化的宿主；调整边框不能反过来触发自动缩放。
  const fit = useCallback(() => {
    if (!root.current) return;
    const width = root.current.clientWidth;
    setAvailableWidth(width);
    setAvailableLeft(Math.min(0, 12 - root.current.getBoundingClientRect().left));
    // 私密草稿的宿主固定在页面原点，适配宽度不随保存/平移位置改变。
    setScale(Math.min(1, Math.max(1, width - (initial.status === "draft" ? 24 : 0)) / viewportWidth.current));
  }, [initial.status]);
  useEffect(() => { fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit); }, [fit]);
  useLayoutEffect(() => {
    const measure = () => {
      const next = { header: header.current?.offsetHeight ?? 0, footer: footer.current?.offsetHeight ?? 0 };
      setControlsSize(previous => previous.header === next.header && previous.footer === next.footer ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    if (header.current) observer.observe(header.current);
    if (footer.current) observer.observe(footer.current);
    measure();
    return () => observer.disconnect();
  }, [editing]);
  useEffect(() => {
    if (!editing || busy) return;
    const reread = () => { if (document.visibilityState === "visible") void refresh(); };
    const id = setInterval(reread, 5000); document.addEventListener("visibilitychange", reread);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", reread); };
  }, [editing, busy, refresh]);
  useEffect(() => { onChanged?.(work); }, [work, onChanged]);
  const merged = useMemo<WorkSnapshot>(() => ({ ...work, ...frame, ...framePreview, posts: work.posts.map(p => ({ ...p, ...texts[p.id] })), elements: work.elements.map(e => ({ ...e, ...photoPatches[e.id] })) }), [work, frame, framePreview, texts, photoPatches]);
  const frameWidth = merged.viewportWidth * scale, frameHeight = merged.viewportHeight * scale;
  const cropOffsetX = (merged.viewportX - initial.viewportX) * scale, cropOffsetY = (merged.viewportY - initial.viewportY) * scale;
  const offsetX = work.status === "draft" ? merged.draftX ?? 24 : cropOffsetX;
  const offsetY = work.status === "draft" ? merged.draftY ?? 40 : cropOffsetY;
  const marginLeft = work.status === "draft" ? 0 : Math.max(0, (availableWidth - initial.viewportWidth * scale) / 2);
  // 控件沿用裁切窗口布局；整稿平移不能改变控件宽度或换行，使其与内容同步移动。
  const frameLeft = work.status === "draft" ? 24 + cropOffsetX : marginLeft + offsetX;
  const visibleLeft = Math.max(availableLeft, frameLeft), visibleRight = Math.min(availableWidth, frameLeft + frameWidth);
  // 超宽窗口仍保留当前比例；操作区锚定其屏幕可见部分，避免被页面水平裁切。
  const controlsWidth = Math.min(availableWidth - availableLeft, Math.max(320, visibleRight - visibleLeft));
  const controlsLeft = Math.max(availableLeft, Math.min(visibleLeft, availableWidth - controlsWidth)) - frameLeft;
  // 极小窗口装不下操作区时，将操作区贴在窗口下方，仍只绘制一个裁切蒙版。
  const controlsOutside = frameHeight < controlsSize.header + controlsSize.footer + 24;
  const frameStyle = {
    width: frameWidth,
    height: editing ? frameHeight : undefined,
    left: offsetX,
    top: offsetY,
    marginLeft,
    "--work-controls-width": `${controlsWidth}px`,
    "--work-controls-left": `${controlsLeft}px`,
    "--work-header-height": `${controlsSize.header}px`,
    "--work-notices-top": `${controlsOutside ? frameHeight + controlsSize.header + controlsSize.footer + 24 : controlsSize.header}px`,
  } as CSSProperties;
  const previewPhoto = (id: string, patch: Partial<WorkElement>) => setPhotoPatches(previous => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  const commitPhoto = (id: string, patch: Partial<WorkElement>) => {
    const parsed = photoPatchSchema.safeParse(patch);
    if (!parsed.success) { setLocalError("图片宽度须为 120–640、高度须为 90–800、旋转须为 −25°–25°"); return false; }
    setLocalError("");
    previewPhoto(id, patch);
    void enqueue({ operation: "photo.update", id, data: parsed.data }).then(result => { if (result) setPhotoPatches(previous => { const next = { ...previous, [id]: { ...previous[id] } }; for (const key of Object.keys(patch)) if (next[id]?.[key as keyof WorkElement] === patch[key as keyof WorkElement]) delete next[id][key as keyof WorkElement]; return next; }); });
    return true;
  };
  const commitFrame = (next: WorkFrameValue, kind: "move" | "resize") => {
    setFramePreview(null);
    setFrame(next);
    const draftPosition = work.status === "draft" ? { draftX: next.draftX, draftY: next.draftY } : {};
    void enqueue({ operation: "frame", data: { ...(kind === "resize" ? onlyWindow(next) : {}), ...draftPosition } }).then(result => { if (result) setFrame(previous => previous === next ? null : previous); });
  };
  const chooseEndpoint = (id: string) => { if (!editing || locked) return; if (!selected) setSelected(id); else if (selected === id) setSelected(null); else { void enqueue({ operation: "connection.create", data: { fromId: selected, toId: id, color: "#72975a" } }); setSelected(null); } };
  const updateText = (id: string, data: { title: string; content: string }) => {
    const next = { ...textRef.current, [id]: { ...data, version: ++textVersion.current } }; textRef.current = next; setTexts(next);
    if (work.status === "draft") { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(flush, 600); }
  };
  const currentPost = merged.posts.find(p => modal === `post:${p.id}`);
  const deleteWork = () => {
    if (busy || leaving || !work.canManage || work.ownerId !== actorId || work.status !== "published") return;
    if (!window.confirm("删除这组已发布作品及其中的全部博文、图片和相关连线？外部相连作品会保留，此操作无法撤销。")) return;
    setDeleting(true); setSelected(null); setLocalError("");
    void enqueue({ operation: "delete" }).then(result => {
      setDeleting(false);
      if (result) { onDeleted(work.id); onClose(); }
    });
  };
  const canvas = <WorkFrame frame={{ ...onlyWindow(merged), ...(work.status === "draft" ? { draftX: merged.draftX ?? 24, draftY: merged.draftY ?? 40 } : {}) }} scale={scale} editing={editing && work.canManage && !locked} movable={work.status === "draft" && work.ownerId === actorId} onPreview={setFramePreview} onCommit={commitFrame}>
    <WorkCanvas work={merged} scale={scale} editing={editing} disabled={state === "auth-invalid" || locked} onPhotoPreview={previewPhoto} onPhotoCommit={commitPhoto} onDeletePhoto={id => { void enqueue({ operation: "photo.delete", id }); }} onPost={id => { if (!locked) setModal(`post:${id}`); }} onSelect={chooseEndpoint} selected={selected} registerAnchor={registerAnchor} />
  </WorkFrame>;
  if (state === "auth-invalid") return <div role="alert">登录已失效。<Link href="/">重新登录</Link></div>;
  return <div ref={root} className="work-editor-host"><section style={frameStyle} className={`blog-work ${editing ? "blog-work-editing" : ""} ${controlsOutside ? "work-controls-outside" : ""}`} data-work-id={work.id} aria-label={work.status === "draft" ? "空间草稿" : "已发布作品"}>
    <header ref={header} className="work-header">
      <span className="work-badge">{work.status === "draft" ? <><strong>DRAFT</strong><LockKeyhole size={14} />仅自己可见</> : <>{work.ownerName} · <time dateTime={work.publishedAt!}>{formatPostTimestamp(new Date(work.publishedAt!), { timezone: work.posts[0]?.authorTimezone, dateOnly: true })}</time></>}</span>
      <div className="work-actions">
        {editing && <span role="status" className={!busy ? "work-save-status work-save-status-saved" : "work-save-status"}>{state === "failed" ? deleting ? "删除失败" : "保存失败" : state === "conflict" ? deleting ? "删除冲突" : "修改冲突" : deleting ? "删除中…" : publishing ? "发布中…" : busy ? "保存中…" : "已自动保存"}</span>}
        {editing && work.status === "published" && work.canManage && work.ownerId === actorId && <button className="work-danger" disabled={busy || leaving} onClick={deleteWork}>删除作品</button>}
        {editing ? <button disabled={deleting} onClick={() => requestLeave(() => { setEditing(false); onClose(); })}>{work.status === "draft" ? "退出草稿" : "退出编辑"}</button> : <button onClick={() => { setEditing(true); void save.refresh(); }}>编辑作品</button>}
        {work.status === "draft" && <button className="work-primary" disabled={busy} onClick={() => { setPublishing(true); void enqueue({ operation: "publish" }).then(result => { setPublishing(false); if (result) onPublished(result); }); }}>发布</button>}
      </div>
    </header>
    <div className="work-notices">{(save.error || localError) && <div className="work-error" role="alert">{save.error || localError} {state === "failed" && <button onClick={save.retry}>{deleting ? "重试删除" : "重试保存"}</button>}{state === "conflict" && <><button onClick={() => { void save.resolveConflict(false).then(() => { setTexts({}); textRef.current = {}; sentVersions.current.clear(); setPhotoPatches({}); setFrame(null); setFramePreview(null); setUploading(false); }); }}>{deleting ? "取消删除并采用最新内容" : "采用最新内容"}</button><button onClick={() => { if (!deleting || window.confirm("作品已有更新，仍要删除整组博文、图片和相关连线？此操作无法撤销。")) void save.resolveConflict(true); }}>{deleting ? "确认删除最新作品" : "重新提交我的修改"}</button></>}</div>}
    {leaving && busy && <div className="work-error" role="status">正在等待保存后离开。{["failed", "conflict"].includes(state) && <button onClick={() => { if (window.confirm("放弃尚未保存的修改并离开？")) pendingLeave.current?.(); }}>放弃未保存修改</button>}</div>}
    </div>
    <div className="work-stage-host">{canvas}</div>
    {editing && <footer ref={footer} className="work-footer">
      <div className="work-toolbar" role="toolbar" aria-label="草稿工具栏">
        {work.canManage && <button disabled={locked} onClick={() => {
          if (work.status === "published") { setModal("new-post"); return; }
          void enqueue({ operation: "post.create", data: { title: "", content: "" } }).then(result => { const post = result?.posts.at(-1); if (post) setModal(`post:${post.id}`); });
        }}><FilePenLine size={19} />博文</button>}
        <button disabled={locked || uploading} onClick={() => fileInput.current?.click()}><ImagePlus size={19} />图片</button>
        <button disabled={locked} onClick={() => setModal("connections")}><Link2 size={19} />连线</button>
      </div>
    </footer>}
    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传作品图片" className="sr-only" disabled={locked} onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; setUploading(true);
      try {
        const bitmap = await createImageBitmap(file);
        const size = fitHomePhotoSizeToBounds({ width: bitmap.width, height: bitmap.height }); bitmap.close();
        await enqueue({ operation: "frame", data: { viewportWidth: work.viewportWidth } }, { file, data: { x: merged.viewportX + merged.viewportWidth * 0.6, y: merged.viewportY + 120, ...size, caption: "" } });
      } catch { setLocalError("无法读取图片，请选择有效的 JPG、PNG 或 WebP 图片"); }
      finally { setUploading(false); }
    }} />
    {modal === "connections" && <WorkConnectionPicker work={merged} actorId={actorId} onConnect={(fromId, toId) => { void enqueue({ operation: "connection.create", data: { fromId, toId, color: "#72975a" } }); }} onDelete={id => { void enqueue({ operation: "connection.delete", id }); }} onClose={() => setModal(null)} />}
    {currentPost && <WorkDialog title={work.canManage && editing ? "编辑博文" : "阅读博文"} onClose={() => { if (work.status === "draft") flush(); setModal(null); }}>
      {work.canManage && editing ? <><WorkPostForm value={currentPost} onChange={data => updateText(currentPost.id, data)} />{work.status === "published" && <button className="work-primary" onClick={flush}>保存博文</button>}<button onClick={() => { if (window.confirm("删除这篇博文？")) { void enqueue({ operation: "post.delete", id: currentPost.id }); setTexts(previous => { const next = { ...previous }; delete next[currentPost.id]; textRef.current = next; return next; }); setModal(null); } }}>删除博文</button></> : <><h3>{currentPost.title}</h3><MarkdownContent content={currentPost.content} /></>}
    </WorkDialog>}
    {modal === "new-post" && <NewPublishedPost onClose={() => setModal(null)} onSave={data => { void enqueue({ operation: "post.create", data }).then(result => { if (result) setModal(null); }); }} />}
  </section></div>;
}
function NewPublishedPost({ onClose, onSave }: { onClose: () => void; onSave: (data: { title: string; content: string }) => void }) {
  const [value, setValue] = useState({ title: "", content: "" });
  return <WorkDialog title="新增博文" onClose={onClose}><WorkPostForm value={value} onChange={setValue} /><button disabled={!value.title.trim() || !value.content.trim()} className="work-primary" onClick={() => onSave(value)}>保存博文</button></WorkDialog>;
}
