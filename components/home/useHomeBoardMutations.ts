"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AtlasConnectionData } from "@/components/atlas/types";
import type { HomeBoardSnapshot, HomePhotoElementData } from "@/components/home/types";

type PhotoPatch = Partial<Pick<HomePhotoElementData, "x" | "y" | "width" | "height" | "caption" | "rotation">>;
type PhotoQueue = { pending: PhotoPatch | null; running: boolean; deleteRequested: boolean };
type MutationKind = "patch" | "photo-delete" | "connection-delete";
type SaveState = {
  id: string;
  kind: MutationKind;
  status: "saving" | "failed";
  subject: string;
  action: "保存" | "删除";
};

function patchSubject(patch: PhotoPatch) {
  const subjects = [
    patch.x !== undefined || patch.y !== undefined ? "照片位置" : null,
    patch.width !== undefined || patch.height !== undefined ? "照片大小" : null,
    patch.caption !== undefined ? "照片标注" : null,
    patch.rotation !== undefined ? "照片角度" : null,
  ].filter(Boolean);
  return subjects.length === 1 ? subjects[0]! : "照片更改";
}

export function useHomeBoardMutations(initialSnapshot: HomeBoardSnapshot) {
  const [elements, setElements] = useState(initialSnapshot.elements);
  const [connections, setConnections] = useState(initialSnapshot.connections);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const photoQueues = useRef(new Map<string, PhotoQueue>());
  const connectionQueues = useRef(new Map<string, AtlasConnectionData & { running: boolean }>());
  const deletedPhotos = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const showState = useCallback((state: SaveState) => {
    setSaveStates((current) => ({ ...current, [`${state.kind}:${state.id}`]: state }));
  }, []);
  const clearStates = useCallback((keys: string[]) => {
    setSaveStates((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }, []);

  const runPhotoQueue = useCallback(async (id: string) => {
    const queue = photoQueues.current.get(id);
    if (!queue || queue.running) return;
    queue.running = true;
    try {
      while (mounted.current && (queue.pending || queue.deleteRequested)) {
        if (queue.deleteRequested) {
          let deleted = false;
          try {
            deleted = (await fetch(`/api/home-board/elements/${id}`, { method: "DELETE" })).ok;
          } catch { /* 网络失败保留照片及连线，交给显式重试。 */ }
          if (!mounted.current) return;

          queue.deleteRequested = false;
          if (!deleted) {
            showState({ id, kind: "photo-delete", subject: "照片", action: "删除", status: "failed" });
            if (queue.pending) {
              showState({ id, kind: "patch", subject: patchSubject(queue.pending), action: "保存", status: "failed" });
            }
            return;
          }

          deletedPhotos.current.add(id);
          photoQueues.current.delete(id);
          setElements((current) => current.filter((element) => element.id !== id));
          setConnections((current) => current.filter((connection) => connection.fromId !== id && connection.toId !== id));
          const keys = [`patch:${id}`, `photo-delete:${id}`];
          for (const [connectionId, connection] of connectionQueues.current) {
            if (connection.fromId === id || connection.toId === id) {
              connectionQueues.current.delete(connectionId);
              keys.push(`connection-delete:${connectionId}`);
            }
          }
          clearStates(keys);
          return;
        }

        const target = queue.pending!;
        queue.pending = null;
        showState({ id, kind: "patch", subject: patchSubject(target), action: "保存", status: "saving" });
        let saved = false;
        try {
          saved = (await fetch(`/api/home-board/elements/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(target),
          })).ok;
        } catch { /* 保留尚未确认的字段；较新的同名字段优先。 */ }
        if (!mounted.current) return;

        if (!saved) {
          const newerPatch = photoQueues.current.get(id)?.pending;
          const retryPatch = { ...target, ...newerPatch };
          queue.pending = retryPatch;
          if (queue.deleteRequested || newerPatch) continue;
          showState({ id, kind: "patch", subject: patchSubject(retryPatch), action: "保存", status: "failed" });
          return;
        }

        // 成功响应不重放整个 element，避免覆盖后续编辑或正在拖动的坐标。
        if (!queue.pending) clearStates([`patch:${id}`]);
      }
    } finally {
      queue.running = false;
      if (!queue.pending && !queue.deleteRequested) photoQueues.current.delete(id);
    }
  }, [clearStates, showState]);

  const updatePhoto = useCallback((id: string, patch: PhotoPatch) => {
    if (deletedPhotos.current.has(id) || photoQueues.current.get(id)?.deleteRequested) return;
    setElements((current) => current.map((element) => element.id === id ? { ...element, ...patch } : element));
  }, []);

  const savePhotoPatch = useCallback((id: string, patch: PhotoPatch) => {
    if (deletedPhotos.current.has(id)) return;
    const queue = photoQueues.current.get(id) ?? { pending: null, running: false, deleteRequested: false };
    if (queue.deleteRequested) return;
    updatePhoto(id, patch);
    queue.pending = { ...queue.pending, ...patch };
    photoQueues.current.set(id, queue);
    showState({ id, kind: "patch", subject: patchSubject(queue.pending), action: "保存", status: "saving" });
    void runPhotoQueue(id);
  }, [runPhotoQueue, showState, updatePhoto]);

  const deletePhoto = useCallback((id: string) => {
    if (deletedPhotos.current.has(id)) return;
    const queue = photoQueues.current.get(id) ?? { pending: null, running: false, deleteRequested: false };
    if (queue.deleteRequested) return;
    queue.deleteRequested = true;
    photoQueues.current.set(id, queue);
    showState({ id, kind: "photo-delete", subject: "照片", action: "删除", status: "saving" });
    void runPhotoQueue(id);
  }, [runPhotoQueue, showState]);

  const deleteConnection = useCallback(async (id: string) => {
    const connection = connections.find((item) => item.id === id);
    if (!connection || connectionQueues.current.get(id)?.running) return;
    const queue = { ...connection, running: true };
    connectionQueues.current.set(id, queue);
    showState({ id, kind: "connection-delete", subject: "连线", action: "删除", status: "saving" });
    let deleted = false;
    try {
      deleted = (await fetch(`/api/home-board/connections?id=${encodeURIComponent(id)}`, { method: "DELETE" })).ok;
    } catch { /* 删除失败时仍保留原连线和可重试状态。 */ }
    // 照片成功删除会级联移除此连线；迟到的连接响应不能复活错误提示。
    if (!mounted.current || connectionQueues.current.get(id) !== queue) return;
    queue.running = false;
    if (!deleted) {
      showState({ id, kind: "connection-delete", subject: "连线", action: "删除", status: "failed" });
      return;
    }
    connectionQueues.current.delete(id);
    setConnections((current) => current.filter((item) => item.id !== id));
    clearStates([`connection-delete:${id}`]);
  }, [clearStates, connections, showState]);

  const retry = useCallback((state: SaveState) => {
    if (state.kind === "photo-delete") deletePhoto(state.id);
    else if (state.kind === "connection-delete") void deleteConnection(state.id);
    else void runPhotoQueue(state.id);
  }, [deleteConnection, deletePhoto, runPhotoQueue]);

  return { elements, setElements, connections, setConnections, saveStates, updatePhoto, savePhotoPatch, deletePhoto, deleteConnection, retry };
}
