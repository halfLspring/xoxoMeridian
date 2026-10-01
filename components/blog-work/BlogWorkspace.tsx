"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBlogActions } from "@/components/blog-work/BlogActionProvider";
import { DraftSelectionOverlay } from "@/components/blog-work/DraftSelectionOverlay";
import { DraftListDialog } from "@/components/blog-work/DraftListDialog";
import { WorkEditor, type LeaveHandler } from "@/components/blog-work/WorkEditor";
import type { AnchorRegistrar } from "@/components/blog-work/WorkCanvas";
import type { WorkSnapshot } from "@/lib/blog-work/types";
import type { CreateWorkInput } from "@/lib/blog-work/schemas";

type BlogWorkspaceProps = { actorId: string; registerAnchor?: AnchorRegistrar; onDraftChange?: (work: WorkSnapshot | null) => void; onPublished?: (work: WorkSnapshot) => void };
export function BlogWorkspace(props: BlogWorkspaceProps) {
  // 账号变化时一并销毁私密草稿、离开守卫及在途请求，不能沿用上个账号的状态。
  return <ActorWorkspace key={props.actorId} {...props} />;
}
function ActorWorkspace({ actorId, registerAnchor, onDraftChange, onPublished }: BlogWorkspaceProps) {
  const [mode, setMode] = useState<"new" | "list" | null>(null), [draft, setDraft] = useState<WorkSnapshot | null>(null), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const guard = useRef<LeaveHandler | null>(null), requestSequence = useRef(0), router = useRouter(), params = useSearchParams();
  const invalidate = useCallback(() => { setPending(false); return ++requestSequence.current; }, []);
  const request = useCallback((next: (sequence: number) => void) => {
    const sequence = invalidate();
    // 等待保存期间也可能切换或退出；迟到的离开回调同样必须失效。
    const proceed = () => { if (sequence === requestSequence.current) next(sequence); };
    if (guard.current) guard.current(proceed); else proceed();
    return () => { if (sequence === requestSequence.current) invalidate(); };
  }, [invalidate]);
  const open = useCallback(async (id: string, sequence: number) => {
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/blog/works/${encodeURIComponent(id)}`, { headers: { "X-Blog-Viewer-Id": actorId }, cache: "no-store" });
      if (!response.ok) throw new Error(); const data = await response.json();
      if (sequence !== requestSequence.current) return;
      setDraft(data.work); setMode(null);
    } catch { if (sequence === requestSequence.current) setError("作品不可用，请从 My Draft 重新选择"); }
    finally { if (sequence === requestSequence.current) setPending(false); }
  }, [actorId]);
  useEffect(() => {
    return () => {
      // 这是请求世代计数，不是 DOM 引用；卸载时使所有在途响应失效。
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestSequence.current++;
    };
  }, []);
  const targetId = params.get("draft") || params.get("work");
  useEffect(() => {
    // 新建草稿仅由右键菜单触发；旧的新建 URL 不再进入框选模式。
    if (!targetId || targetId === "new") return;
    // effect 重放时重新发起；清理仅取消本次意图，不误伤后来从列表发起的请求。
    // URL 是外部导航状态，入口切换需要立即撤销旧等待并经过保存守卫。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    return request(sequence => {
      if (targetId === "list") { setDraft(null); setError(""); setMode("list"); }
      else void open(targetId, sequence);
    });
  }, [targetId, request, open]);
  const { intent, consume } = useBlogActions() ?? {};
  useEffect(() => {
    if (!intent || !consume) return;
    // 放在深链 effect 之后，水合期间用户的新选择优先于页面原有 URL。
    // 通过保存守卫后才消费；只清掉这一条，不能误删更新的选择。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const cancel = request(() => {
      consume(intent);
      setDraft(null); setError(""); setMode(intent.action);
    });
    return () => {
      cancel();
      // 工作区可能先于页面卸载；丢弃其尚在等待保存的动作，重挂载时不再重放。
      consume(intent);
    };
  }, [intent, consume, request]);
  useEffect(() => { onDraftChange?.(draft); return () => onDraftChange?.(null); }, [draft, onDraftChange]);
  const close = () => { invalidate(); setDraft(null); setError(""); const url = new URL(window.location.href); url.searchParams.delete("draft"); url.searchParams.delete("work"); url.searchParams.delete("post"); window.history.replaceState(null, "", url.pathname + url.search); router.refresh(); };
  return <>
    {error && <div className="work-workspace-error" role="alert">{error}</div>}{pending && mode !== "list" && <p role="status">{mode === "new" ? "正在创建草稿…" : "正在打开作品…"}</p>}
    {mode === "new" && <DraftSelectionOverlay pending={pending} error={error} onCancel={() => { invalidate(); setMode(null); setError(""); }} onCreate={async (input: CreateWorkInput) => {
      setPending(true); setError(""); const sequence = ++requestSequence.current;
      try {
        const response = await fetch("/api/blog/works", { method: "POST", headers: { "Content-Type": "application/json", "X-Blog-Viewer-Id": actorId }, body: JSON.stringify(input) });
        if (!response.ok) throw new Error(); const data = await response.json();
        if (sequence !== requestSequence.current) return;
        setDraft(data.work); setMode(null);
      } catch { if (sequence === requestSequence.current) setError("创建失败，请重试"); }
      finally { if (sequence === requestSequence.current) setPending(false); }
    }} />}
    {mode === "list" && <DraftListDialog actorId={actorId} onClose={() => { invalidate(); setMode(null); setError(""); }} onOpen={id => request(sequence => void open(id, sequence))} />}
    {draft && <div className="active-draft" style={{ top: draft.draftY ?? 40, left: `min(${Math.max(12, draft.draftX ?? 24)}px, calc(100% - 172px))` }}><WorkEditor key={`${actorId}:${draft.id}`} initial={draft} actorId={actorId} editable focusPostId={params.get("post") ?? undefined} leaveRef={guard} onClose={close} onPublished={result => { onPublished?.(result); close(); requestAnimationFrame(() => document.querySelector(`[data-work-id="${result.id}"]`)?.scrollIntoView({ block: "center" })); }} registerAnchor={registerAnchor} onChanged={onDraftChange} /></div>}
  </>;
}
