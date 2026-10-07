"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Endpoint = { id: string; type: string };
export type ConnectionScope = {
  id: string;
  status?: "draft" | "published";
  elements: Endpoint[];
  editable: boolean;
  disabled: boolean;
  saving?: boolean;
  create: (fromId: string, toId: string) => Promise<unknown>;
  remove?: (id: string) => void;
};
type Selection = { id: string; scopeId: string };
const ConnectionContext = createContext<{
  selectedId: string | null;
  hasWorkEditor: boolean;
  select: (id: string) => void;
  clear: () => void;
  register: (scope: ConnectionScope) => void;
  unregister: (id: string) => void;
  deleteAction: (connection: { id: string; workId: string }, index: number) => { label: string; disabled: boolean; onDelete: () => void } | undefined;
} | null>(null);

export const useCanvasConnections = () => useContext(ConnectionContext);

export function CanvasConnectionProvider({ children }: { children: ReactNode }) {
  const [scopes, setScopes] = useState(() => new Map<string, ConnectionScope>());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const selection = useRef<Selection | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    selection.current = null;
    setSelectedId(null);
  }, []);
  const register = useCallback((scope: ConnectionScope) => {
    const selected = selection.current;
    if (selected?.scopeId === scope.id && (scope.disabled || !scope.elements.some(element => element.id === selected.id))) clear();
    setScopes(previous => new Map(previous).set(scope.id, scope));
  }, [clear]);
  const unregister = useCallback((id: string) => {
    if (selection.current?.scopeId === id) clear();
    setScopes(previous => {
      const next = new Map(previous); next.delete(id); return next;
    });
  }, [clear]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") clear(); };
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("keydown", cancel);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [clear]);

  const select = (id: string) => {
    const target = [...scopes.values()].find(scope => scope.elements.some(element => element.id === id));
    if (!target || target.disabled) return;
    setError("");
    const from = selection.current;
    if (!from) {
      selection.current = { id, scopeId: target.id };
      setSelectedId(id);
      timer.current = setTimeout(clear, 1500);
      return;
    }
    clear();
    if (from.id === id) return;
    const source = scopes.get(from.scopeId);
    if (!source || source.disabled || !source.elements.some(element => element.id === from.id)) return;
    if (source.elements.find(element => element.id === from.id)?.type === "note" && target.elements.find(element => element.id === id)?.type === "note") {
      setError("不能连接两篇博文，请选择至少一张图片");
      return;
    }
    const ends = [source, target];
    // 私密端点始终由其草稿保存；公开作品之间固定归属，不能由点击顺序改变权限或版本链路。
    const draft = ends.find(scope => scope.status === "draft");
    const owner = draft ?? ends.filter(scope => scope.status && scope.editable).sort((a, b) => a.id.localeCompare(b.id))[0]
      ?? (ends.every(scope => !scope.status) ? source : undefined);
    if (!owner?.editable || owner.disabled) {
      setError("请先进入作品编辑，再连接图文");
      return;
    }
    const ownerFirst = owner.elements.some(element => element.id === from.id);
    void owner.create(ownerFirst ? from.id : id, ownerFirst ? id : from.id).catch(() => setError("连线保存失败，请重新点击两端重试"));
  };
  const deleteAction = (connection: { id: string; workId: string }, index: number) => {
    const owner = scopes.get(connection.workId);
    if (!owner?.editable || !owner.remove) return undefined;
    return { label: `删除作品连线 ${index + 1}`, disabled: owner.disabled || !!owner.saving, onDelete: () => owner.remove?.(connection.id) };
  };
  return <ConnectionContext.Provider value={{ selectedId, select, clear, register, unregister, deleteAction, hasWorkEditor: [...scopes.values()].some(scope => scope.status && scope.editable && !scope.disabled) }}>
    {children}
    {error && <div role="alert" className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg border bg-white px-4 py-3 text-sm">{error}</div>}
  </ConnectionContext.Provider>;
}
