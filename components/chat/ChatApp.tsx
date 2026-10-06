"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import { AgentStatusBadge } from "@/components/chat/AgentStatusBadge";
import { LeftRail } from "@/components/chat/LeftRail";
import { LifePanel } from "@/components/chat/LifePanel";
import { MessageComposer } from "@/components/chat/MessageComposer";
import { ToolApprovalPanel } from "@/components/chat/ToolApprovalPanel";
import { BrandBadge } from "@/components/layout/BrandBadge";
import { MessageList } from "@/components/chat/MessageList";
import type { ChatUser, RoomSnapshot } from "@/components/chat/types";
import { useRoomChat } from "@/components/chat/useRoomChat";
import { dedupedReplace } from "@/lib/router-dedup";

export function ChatApp({
  currentUser,
  initialSnapshot,
}: {
  currentUser: ChatUser;
  initialSnapshot: RoomSnapshot;
}) {
  const router = useRouter();

  const onAuthMismatch = useCallback(
    (userId: string) => {
      window.location.replace(
        `/chat?auth=${encodeURIComponent(userId)}-${Date.now()}`,
      );
    },
    [],
  );

  const onUnauthenticated = useCallback(() => {
    dedupedReplace(router, "/");
  }, [router]);

  const onRoomDeleted = useCallback(() => {
    dedupedReplace(router, "/chat");
  }, [router]);

  const {
    snapshot,
    connState,
    authSyncing,
    replaceMessage,
    removeMessage,
    appendMessage,
    sendMessage,
    roomId,
  } = useRoomChat({
    currentUser,
    initialSnapshot,
    redirects: { onAuthMismatch, onUnauthenticated, onRoomDeleted },
  });

  const participants = useMemo(
    () => snapshot.room.participants.map((p) => p.user),
    [snapshot.room.participants],
  );
  const latestStatus = snapshot.agentStatus.recentTasks[0]?.status;

  if (authSyncing) {
    return (
      <main className="flex h-screen min-h-[720px] items-center justify-center bg-sage-50 text-sm text-black/50">
        正在同步登录状态…
      </main>
    );
  }

  return (
    <main className="flex h-screen min-h-[720px] flex-col bg-sage-50 text-ink">
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-[#e8e8e8] bg-white/95 backdrop-blur-xs px-5">
        <div className="flex items-center gap-6">
          <BrandBadge />
          <Link
            href="/home"
            className="text-xs font-medium text-black/50 hover:text-black transition-colors"
          >
            Blog
          </Link>
          <Link
            href="/chat"
            className="text-xs font-medium text-[#3a5b22] transition-colors"
          >
            Chat
          </Link>
          <Link
            href="/study"
            className="text-xs font-medium text-black/50 hover:text-black transition-colors"
          >
            Study
          </Link>
          <span className="text-black/20">|</span>
          <span className="text-xs font-medium text-black/70">
            {snapshot.room.name}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-xs text-black/40">
            {connState !== "open" && (
              <span className="inline-flex items-center gap-1 text-sage-600">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sage-500" />
                {connState === "connecting" ? "连接中…" : "重连中…"}
              </span>
            )}
          </p>
          <AgentStatusBadge
            isWorking={snapshot.agentStatus.isWorking}
            latestStatus={latestStatus}
          />
        </div>
      </header>

      <ToolApprovalPanel approvals={snapshot.agentStatus.pendingApprovals ?? []} />

      <div className="flex min-h-0 flex-1">
        <LeftRail
          currentUser={currentUser}
          currentRoomId={roomId}
          participants={participants}
          rooms={snapshot.rooms ?? []}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <MessageList currentUser={currentUser} messages={snapshot.messages} />
          <MessageComposer
            currentUser={currentUser}
            onSubmitMessage={sendMessage}
          />
        </section>

        <LifePanel
          currentUserId={currentUser.id}
          memos={snapshot.memos}
          participants={participants}
          roomId={roomId}
          scheduledJobs={snapshot.scheduledJobs ?? []}
        />
      </div>
    </main>
  );
}
