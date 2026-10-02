"use client";

import { AnswerReferences } from "@/components/chat/AnswerReferences";
import { useEffect, useId, useRef, useState } from "react";
import { LocateFixed, Trash2 } from "lucide-react";
import { ToolApprovalPanel } from "@/components/chat/ToolApprovalPanel";
import type { AgentConversationState } from "@/components/agent-entry/use-agent-conversation";
import styles from "@/components/agent-entry/agent-entry.module.css";

const taskLabels: Record<string, string> = {
  pending: "正在等待小助手…", running: "小助手正在思考…", waiting_approval: "有操作需要你确认。",
  failed: "这次处理失败，请重新发送消息。", cancelled: "任务已取消。", limit_exceeded: "本次处理已达到限额，请重新发送消息。",
};

export default function AgentConversationDialog({ conversation, principalId, titleId, reducedMotion, onClose, onIdentityInvalid, onResetPosition }: {
  conversation: AgentConversationState;
  principalId: string;
  titleId: string;
  reducedMotion: boolean;
  onClose: () => void;
  onIdentityInvalid: () => void;
  onResetPosition?: () => void;
}) {
  const { snapshot, messages: conversationMessages, tasks, draft, setDraft, pending, readError, sendError, clearError, sending, clearing, send, clear, retry, refresh } = conversation;
  const inputId = useId();
  const messages = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const touchHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [touchHint, setTouchHint] = useState<"reset" | "clear" | null>(null);
  const latest = tasks[0];
  const currentTask = tasks.find((task) => ["pending", "running", "waiting_approval"].includes(task.status)) ?? latest;
  const messageKey = `${conversationMessages.at(-1)?.id ?? ""}:${pending.length}`;

  useEffect(() => {
    const list = messages.current;
    if (list) {
      if (list.scrollTo) list.scrollTo({ top: list.scrollHeight, behavior: reducedMotion ? "instant" : "smooth" });
      else list.scrollTop = list.scrollHeight;
    }
  }, [messageKey, reducedMotion]);

  useEffect(() => () => {
    if (touchHintTimer.current) clearTimeout(touchHintTimer.current);
  }, []);

  const revealTouchHint = (action: "reset" | "clear") => {
    setTouchHint(action);
    if (touchHintTimer.current) clearTimeout(touchHintTimer.current);
    touchHintTimer.current = setTimeout(() => setTouchHint(null), 2000);
  };

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <header className={styles.panelHeader}>
        <div><h2 id={titleId}>与小助手聊天</h2><p className={styles.subtitle}>只属于你和小助手的对话</p></div>
        <div className={styles.headerActions}>
          {onResetPosition && <button type="button" className={styles.resetButton} aria-label="归位"
            onClick={onResetPosition} onTouchStart={() => revealTouchHint("reset")}
            data-touch-hint={touchHint === "reset"}>
            <LocateFixed size={17} strokeWidth={1.8} aria-hidden="true" />
            <span className={styles.actionHint} aria-hidden="true">归位</span>
          </button>}
          <button type="button" className={styles.clearButton} disabled={sending || clearing}
            aria-label="清空与小助手的聊天记录" onClick={() => {
              if (window.confirm("确定清空与小助手的聊天记录吗？消息、任务记录和对话记忆将永久删除；独立的备忘录与计划会保留。")) void clear();
            }} onTouchStart={() => revealTouchHint("clear")} data-touch-hint={touchHint === "clear"}>
            <Trash2 size={17} strokeWidth={1.8} aria-hidden="true" />
            <span className={styles.actionHint} aria-hidden="true">{clearing ? "清空中…" : "清空"}</span>
          </button>
          <button type="button" className={styles.closeButton} aria-label="关闭对话" onClick={onClose}>×</button>
        </div>
      </header>
      {snapshot && <ToolApprovalPanel
        approvals={snapshot.pendingApprovals}
        expectedViewerId={principalId}
        onComplete={refresh}
        onIdentityInvalid={onIdentityInvalid}
      />}
      <div ref={messages} className={styles.messages} role="log" aria-label="与小助手的消息" aria-live="polite" aria-relevant="additions">
        {!snapshot && !readError && conversationMessages.length === 0 && <p className={styles.empty}>正在读取对话…</p>}
        {snapshot && conversationMessages.length === 0 && <p className={styles.empty}>今天有什么想聊的？直接告诉我就好。</p>}
        {conversationMessages.map((message) => (
          <article key={message.id} className={`${styles.message} ${message.role === "user" ? styles.humanMessage : styles.agentMessage}`}>
            <p className={styles.sender}>{message.role === "user" ? "你" : snapshot?.agent.displayName ?? "小助手"}</p>
            <p className={styles.messageContent}>{message.content}</p>
            {message.role === "agent" && <AnswerReferences content={message.content} references={message.references} />}
          </article>
        ))}
        {pending.map((record) => (
          <article key={record.clientMessageId} className={`${styles.message} ${styles.humanMessage}`}>
            <p className={styles.sender}>你 · {record.state === "sending" ? "发送中" : "未确认送达"}</p>
            <p className={styles.messageContent}>{record.content}</p>
            {record.state === "failed" && <button type="button" disabled={sending || clearing} className={styles.textButton} onClick={() => void retry(record)}>重试原消息</button>}
          </article>
        ))}
      </div>
      <div className={styles.status} role="status">
        {snapshot?.agent.enabled === false ? "小助手暂时不可用。" : currentTask && taskLabels[currentTask.status]}
      </div>
      {readError && <p role="alert" className={styles.error}>{readError} <button type="button" className={styles.textButton} onClick={refresh}>重新读取</button></p>}
      {sendError && <p role="alert" className={styles.error}>{sendError}</p>}
      {clearError && <p role="alert" className={styles.error}>{clearError}</p>}
      <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); if (!composing.current) send(); }}>
        <label htmlFor={inputId} className="sr-only">消息</label>
        <textarea
          id={inputId} value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={4000}
          placeholder="和小助手说点什么…"
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) {
              event.preventDefault();
              if (snapshot?.agent.enabled !== false) send();
            }
          }}
        />
        <button type="submit" disabled={sending || clearing || !draft.trim() || snapshot?.agent.enabled === false} className={styles.sendButton}>发送</button>
      </form>
    </section>
  );
}
