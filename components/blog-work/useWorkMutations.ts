"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkSnapshot } from "@/lib/blog-work/types";
import type { MutationInput, WorkCommand } from "@/lib/blog-work/schemas";

type Task = { command: WorkCommand; input?: MutationInput; base: WorkSnapshot; upload?: { file: File; data: unknown }; resolve: (work: WorkSnapshot | null) => void; rebased?: boolean };
export type SaveState = "clean" | "saving" | "failed" | "conflict" | "auth-invalid";
function sameFields(base: WorkSnapshot, latest: WorkSnapshot, command: WorkCommand) {
  let a: unknown, b: unknown;
  if (command.operation === "frame") { a = base; b = latest; }
  else if (command.operation === "post.update") { a = base.posts.find(p => p.id === command.id); b = latest.posts.find(p => p.id === command.id); }
  else if (command.operation === "photo.update") { a = base.elements.find(p => p.id === command.id); b = latest.elements.find(p => p.id === command.id); }
  else return false;
  return !!a && !!b && "data" in command && Object.keys(command.data).every(key => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]);
}
export function useWorkMutations(initial: WorkSnapshot, actorId: string) {
  const [work, setWork] = useState(initial), [state, setState] = useState<SaveState>("clean"), [error, setError] = useState("");
  const current = useRef(initial), queue = useRef<Task[]>([]), running = useRef(false), mounted = useRef(true), stateRef = useRef<SaveState>("clean");
  const drainRef = useRef<() => Promise<void>>(async () => {});
  const changeState = useCallback((next: SaveState) => { stateRef.current = next; if (mounted.current) setState(next); }, []);
  const apply = useCallback((next: WorkSnapshot) => { current.current = next; if (mounted.current) setWork(next); }, []);
  const readLatest = useCallback(async () => {
    const response = await fetch(`/api/blog/works/${initial.id}`, { cache: "no-store", headers: { "X-Blog-Viewer-Id": actorId } });
    if (response.status === 401) { changeState("auth-invalid"); return null; }
    if (!response.ok) throw new Error("读取作品失败");
    return (await response.json()).work as WorkSnapshot;
  }, [actorId, initial.id, changeState]);
  const drain = useCallback(async () => {
    if (running.current || !mounted.current || ["failed", "conflict", "auth-invalid"].includes(stateRef.current)) return;
    running.current = true;
    let rejected = false;
    try {
      while (queue.current.length && mounted.current) {
        changeState("saving");
        const task = queue.current[0];
        task.input ??= { mutationId: crypto.randomUUID(), baseRevision: current.current.revision, expectedStatus: task.base.status };
        const headers: Record<string, string> = { "X-Blog-Viewer-Id": actorId };
        let body: BodyInit;
        if (task.upload) {
          const form = new FormData(); form.set("file", task.upload.file); form.set("metadata", JSON.stringify({ ...task.input, data: task.upload.data })); body = form;
        } else { headers["Content-Type"] = "application/json"; body = JSON.stringify({ ...task.input, command: task.command }); }
        const response = await fetch(`/api/blog/works/${initial.id}${task.upload ? "/uploads" : ""}`, { method: task.upload ? "POST" : "PATCH", headers, body });
        if (!mounted.current) return;
        if (response.status === 401) { changeState("auth-invalid"); setError("登录已失效，请重新登录"); queue.current.forEach(t => t.resolve(null)); queue.current = []; return; }
        const data = await response.json();
        // 删除期间另一标签页可能已完成同一目标；确认资源不存在即可关闭旧作品。
        if (task.command.operation === "delete" && response.status === 404 && data.code === "NOT_FOUND") {
          queue.current.shift(); task.resolve(current.current); continue;
        }
        if (!response.ok) {
          setError(data.error || "保存失败，请重试");
          if (data.code === "REVISION_CONFLICT" && !task.upload) {
            const latest = await readLatest();
            if (latest && latest.status === task.input.expectedStatus && !task.rebased && sameFields(task.base, latest, task.command)) {
              apply(latest); task.base = latest; task.input = undefined; task.rebased = true; continue;
            }
          }
          if (response.status === 400 || (response.status === 409 && ["DUPLICATE_CONNECTION", "EMPTY_WORK", "UPLOAD_PENDING", "SLUG_CONFLICT"].includes(data.code))) {
            queue.current.shift(); task.resolve(null); rejected = true; continue;
          }
          changeState(response.status === 409 || response.status === 404 ? "conflict" : "failed"); return;
        }
        queue.current.shift();
        if (data.work && data.work.revision >= current.current.revision) apply(data.work);
        task.resolve(data.work ?? (data.deleted ? current.current : null));
      }
      if (mounted.current) { changeState("clean"); if (!rejected) setError(""); }
    } catch { if (mounted.current) { changeState("failed"); setError("网络异常，未确认保存，请重试"); } }
    finally { running.current = false; }
  }, [actorId, initial.id, apply, changeState, readLatest]);
  useEffect(() => { drainRef.current = drain; }, [drain]);
  const enqueue = useCallback((command: WorkCommand, upload?: Task["upload"]) => new Promise<WorkSnapshot | null>(resolve => {
    queue.current.push({ command, upload, base: current.current, resolve });
    if (stateRef.current === "clean") changeState("saving");
    void drainRef.current();
  }), [changeState]);
  const retry = useCallback(() => { if (stateRef.current === "auth-invalid") return; changeState("saving"); void drainRef.current(); }, [changeState]);
  const resolveConflict = useCallback(async (keepMine: boolean) => {
    try {
      const latest = await readLatest();
      if (!latest || !mounted.current) return;
      const task = queue.current[0];
      if (keepMine && task?.input?.expectedStatus !== latest.status) { setError("草稿已发布，不能把迟到修改自动公开。请采用最新内容后重新编辑。"); return; }
      apply(latest);
      if (keepMine && task && !task.upload) { task.input = undefined; task.base = latest; task.rebased = true; }
      else { queue.current.forEach(t => t.resolve(null)); queue.current = []; }
      changeState(queue.current.length ? "saving" : "clean"); setError(""); void drainRef.current();
    } catch { setError("读取最新内容失败，请重试"); }
  }, [readLatest, apply, changeState]);
  const refresh = useCallback(async () => {
    if (stateRef.current !== "clean" || running.current) return;
    try { const latest = await readLatest(); if (latest && mounted.current && stateRef.current === "clean") apply(latest); } catch { /* 保存状态不因后台回读失败而伪报写入失败。 */ }
  }, [readLatest, apply]);
  useEffect(() => {
    mounted.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (queue.current.length) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { mounted.current = false; window.removeEventListener("beforeunload", beforeUnload); };
  }, []);
  return { work, state, error, enqueue, retry, resolveConflict, refresh, isClean: () => stateRef.current === "clean", queued: () => queue.current.length };
}
