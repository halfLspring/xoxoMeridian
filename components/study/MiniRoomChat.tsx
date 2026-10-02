"use client";

import { useRef, useState } from "react";

import { AnswerReferences } from "@/components/chat/AnswerReferences";
import type { ChatUser, RoomSnapshot } from "@/components/chat/types";
import { useRoomChat } from "@/components/chat/useRoomChat";

export function MiniRoomChat({
  currentUser,
  initialSnapshot,
}: {
  currentUser: ChatUser;
  initialSnapshot: RoomSnapshot;
}) {
  const { snapshot, sendMessage } = useRoomChat({
    currentUser,
    initialSnapshot,
    redirectOnRoomDeleted: false,
  });

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const messages = snapshot.messages;

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    const result = await sendMessage(text);
    setSending(false);

    if (result.ok) {
      setDraft("");
      // Scroll to bottom after render
      requestAnimationFrame(() => {
        if (listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight;
        }
      });
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString("zh-CN", {
      timeZone: currentUser.profile?.timezone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="flex flex-col h-[360px]">
      {/* Header */}
      <div className="shrink-0 border-b border-sage-100 bg-sage-50/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-[#3a5b22]">悄悄话</h3>
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 ? (
          <p className="text-xs text-black/30 text-center py-8">
            还没有消息，说点什么互相鼓励吧。
          </p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="flex gap-2 items-start">
              {/* Avatar */}
              <div className="shrink-0 w-6 h-6 rounded-full bg-[#3a5b22]/10 flex items-center justify-center text-[10px] font-semibold text-[#3a5b22]">
                {msg.sender?.avatarLabel ?? "?"}
              </div>
              {/* Body */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-black/70">
                    {msg.sender?.displayName ?? msg.senderAgent?.displayName ?? "未知"}
                  </span>
                  <span className="text-[10px] text-black/30">
                    {formatTime(msg.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-black/80 leading-relaxed break-words">
                  {msg.content}
                </p>
                {msg.senderType === "agent" && <AnswerReferences content={msg.content} references={msg.references} />}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-sage-100 bg-sage-50/60 px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 min-w-0 h-9 rounded-[8px] border border-sage-200 bg-white px-3 text-sm outline-none transition-colors placeholder:text-black/30 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15"
            placeholder="说点什么..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSend();
              }
            }}
            disabled={sending}
          />
          <button
            type="button"
            className="shrink-0 h-9 rounded-[8px] bg-[#3a5b22] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#2e4a1a] disabled:opacity-50 cursor-pointer"
            disabled={sending || !draft.trim()}
            onClick={() => handleSend()}
          >
            {sending ? "发送" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}
