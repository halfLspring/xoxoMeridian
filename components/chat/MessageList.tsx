"use client";

import { memo, useEffect, useRef } from "react";

import { AnswerReferences } from "@/components/chat/AnswerReferences";
import type { ChatMessage, ChatUser } from "@/components/chat/types";
import { MENTION_AGENT } from "@/lib/identity";
import { cn } from "@/lib/utils";

export function MessageList({
  messages,
  currentUser
}: {
  messages: ChatMessage[];
  currentUser: ChatUser;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {messages.map((message) => (
          <MemoMessageBubble
            key={message.id}
            currentUser={currentUser}
            message={message}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  currentUser
}: {
  message: ChatMessage;
  currentUser: ChatUser;
}) {
  const isMine = message.senderType === "human" && message.senderId === currentUser.id;
  const isAgent = message.senderType === "agent";
  const isSystem = message.senderType === "system";
  const senderName = message.sender?.displayName ?? message.senderAgent?.displayName ?? (isSystem ? "系统" : "未知");

  return (
    <div className={cn("flex", isMine ? "justify-end" : "justify-start")}>
      <article
        className={cn(
          "max-w-[82%] rounded-[10px] border px-4 py-3 shadow-sm",
          isMine && "border-ink/10 bg-ink text-white",
          isAgent && "border-[#e8e8e8] bg-[#fafbfc] text-ink",
          isSystem && "border-[#e8e8e8] bg-white text-ink/60",
          !isMine && !isAgent && !isSystem && "border-[#e8e8e8] bg-white text-ink"
        )}
      >
        <header className={cn("mb-1 flex flex-wrap items-center gap-2 text-xs", isMine ? "text-white/70" : "text-black/50")}>
          <span className="font-semibold">{senderName}</span>
          <span>{formatTime(message.createdAt, currentUser.profile?.timezone)}</span>
          {isAgent ? <span className="rounded-full bg-[#3a5b22]/10 px-2 py-0.5 text-[#3a5b22]">由 {MENTION_AGENT} 处理</span> : null}
          {message.sourceTask ? <span className="rounded-full bg-sage-100 px-2 py-0.5 text-sage-700">已派发</span> : null}
        </header>

        <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>

        {isAgent && <AnswerReferences content={message.content} references={message.references} />}
        {isAgent && message.finalTask ? (
          <details className={cn("mt-3 rounded-[8px] border p-2 text-xs", isMine ? "border-white/20" : "border-[#e8e8e8] bg-white")}>
            <summary className="cursor-pointer select-none font-medium">执行链路</summary>
            <div className="mt-2 space-y-2">
              <p>task_id: {message.finalTask.id}</p>
              <p>status: {message.finalTask.status}</p>
              <div>
                <p className="font-medium">tools</p>
                {(message.finalTask.toolCalls ?? []).map((call) => (
                  <p key={call.id}>
                    {call.toolName} / {call.status}
                    {call.durationMs ? ` / ${call.durationMs}ms` : ""}
                    {call.error ? ` / ${call.error}` : ""}
                  </p>
                ))}
              </div>
              <div>
                <p className="font-medium">llm</p>
                {(message.finalTask.llmCalls ?? []).map((call) => (
                  <p key={call.id}>
                    {call.provider} / {call.model} / {call.status}
                    {call.totalTokens ? ` / ${call.totalTokens} tokens` : ""}
                  </p>
                ))}
              </div>
            </div>
          </details>
        ) : null}
      </article>
    </div>
  );
}

const MemoMessageBubble = memo(MessageBubble);

function formatTime(value: string, timezone?: string | null) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone || "UTC",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
