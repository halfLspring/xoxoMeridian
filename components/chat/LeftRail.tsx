"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ChatUser, RoomSummary } from "@/components/chat/types";

export function LeftRail({
  currentUser,
  participants,
  currentRoomId,
  rooms,
}: {
  currentUser: ChatUser;
  participants: ChatUser[];
  currentRoomId: string;
  rooms: RoomSummary[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "create" | "wipe" | "delete">(null);

  const onCreate = async () => {
    if (busy) return;
    setBusy("create");
    try {
      const resp = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!resp.ok) throw new Error(`create failed: ${resp.status}`);
      const data = await resp.json();
      router.push(`/chat/${data.room.id}`);
    } catch (err) {
      alert(`创建会话失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const onWipe = async () => {
    if (busy) return;
    if (!confirm("清空当前会话的所有消息 / 备忘 / 提醒 / 记忆？房间本身保留。此操作不可撤销。")) return;
    setBusy("wipe");
    try {
      const resp = await fetch(`/api/rooms/${currentRoomId}/messages`, { method: "DELETE" });
      if (!resp.ok) throw new Error(`wipe failed: ${resp.status}`);
      router.refresh();
    } catch (err) {
      alert(`清空失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    if (busy) return;
    if (!confirm("删除整个会话窗口（含所有数据）？此操作不可撤销。")) return;
    setBusy("delete");
    try {
      const resp = await fetch(`/api/rooms/${currentRoomId}`, { method: "DELETE" });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error ?? `delete failed: ${resp.status}`);
      }
      router.push("/chat");
    } catch (err) {
      alert(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="hidden w-64 shrink-0 border-r border-[#e8e8e8] bg-white p-4 lg:block">
      <div className="space-y-5">
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-black">会话列表</h2>
            <button
              type="button"
              onClick={onCreate}
              disabled={busy !== null}
              className="rounded-[10px] border border-[#d9d9d9] bg-white px-2.5 py-1 text-xs font-medium text-[#3a5b22] transition-colors duration-200 hover:bg-[#3a5b22] hover:text-white focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden disabled:opacity-50 cursor-pointer"
            >
              + 新建
            </button>
          </div>
          <div className="mt-2 max-h-60 space-y-1 overflow-y-auto">
            {rooms.map((room) => {
              const active = room.id === currentRoomId;
              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => !active && router.push(`/chat/${room.id}`)}
                  className={`flex w-full items-center justify-between rounded-[10px] px-2.5 py-1.5 text-left text-xs transition-colors duration-200 cursor-pointer ${
                    active
                      ? "bg-[#3a5b22]/10 font-medium text-[#3a5b22]"
                      : "text-black/60 hover:bg-[#fafbfc]"
                  }`}
                >
                  <span className="truncate">{room.name}</span>
                  <span className="ml-2 shrink-0 text-[10px] text-black/30">{room.messageCount}</span>
                </button>
              );
            })}
            {rooms.length === 0 && <p className="px-2 py-1 text-xs text-black/40">载入中…</p>}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={onWipe}
              disabled={busy !== null}
              className="flex-1 rounded-[10px] border border-[#d9d9d9] bg-white px-2 py-1.5 text-xs text-black/60 transition-colors duration-200 hover:bg-neutral-50 focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden disabled:opacity-50 cursor-pointer"
              title="清空当前会话的所有数据，保留房间"
            >
              {busy === "wipe" ? "清空中…" : "清空当前"}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy !== null}
              className="flex-1 rounded-[10px] border border-red-200 bg-white px-2 py-1.5 text-xs text-red-600 transition-colors duration-200 hover:bg-red-50 focus:ring-2 focus:ring-red-500/15 focus:outline-hidden disabled:opacity-50 cursor-pointer"
              title="彻底删除整个会话窗口"
            >
              {busy === "delete" ? "删除中…" : "删除会话"}
            </button>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-black">房间成员</h2>
          <div className="mt-3 space-y-2">
            {participants.map((user) => (
              <div key={user.id} className="flex items-center gap-3 rounded-[10px] border border-[#e8e8e8] bg-[#fafbfc] p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3a5b22]/10 text-sm font-semibold text-[#3a5b22]">
                  {user.avatarLabel}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-black">
                    {user.displayName}
                    {user.id === currentUser.id ? " · 当前" : ""}
                  </p>
                  <p className="truncate text-xs text-black/50">{user.profile?.city ?? "未设置城市"}</p>
                  {user.studyStatus?.state === "running" ? (
                    <p className="mt-1 inline-flex rounded-full bg-[#059669]/10 px-2 py-0.5 text-[11px] font-medium text-[#047857]">
                      专注中
                    </p>
                  ) : null}
                  {user.id === currentUser.id ? (
                    <Link className="text-[11px] text-[#0f3dde] transition-colors duration-200 hover:text-[#0c35c0] hover:underline" href="/me">
                      个人设置
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
