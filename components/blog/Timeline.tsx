"use client";

import type { WorkSnapshot } from "@/lib/blog-work/types";
import { useMemo } from "react";
import { PostCard } from "@/components/blog/PostCard";
import { PostCardSpatialShell } from "@/components/home/PostCardSpatialShell";
import { useScrollReveal } from "@/lib/useScrollReveal";
import { compareTimelinePosts } from "@/lib/post-timeline";
import { cn } from "@/lib/utils";

type Direction = "left" | "right";

const DIRECTION_CLASS: Record<Direction, string> = {
  left: "revealed-left",
  right: "revealed-right",
};

const ALIGN_CLASS: Record<Direction, string> = {
  left: "md:justify-start md:pr-[calc(50%+2rem)] justify-start",
  right: "md:justify-end md:pl-[calc(50%+2rem)] justify-start",
};

export type TimelinePost = {
  id: string;
  slug: string;
  title: string;
  content: string;
  type: string;
  authorId: string | null;
  agentRequesterId?: string | null;
  authorCity?: string | null;
  authorCountry?: string | null;
  authorTimezone?: string | null;
  publishedAt: Date | string;
  metadata?: Record<string, unknown> | null;
  author: {
    id: string;
    displayName: string;
    avatarLabel: string;
    profile?: { timezone: string; city: string; country: string } | null;
  } | null;
};

type TimelineEntry =
  | { kind: "post"; id: string; sortAt: number; post: TimelinePost }
  | { kind: "work"; id: string; sortAt: number; work: WorkSnapshot };

function TimelineItem({
  children,
  side,
}: {
  children: React.ReactNode;
  side: Direction;
}) {
  const { ref, visible } = useScrollReveal();

  return (
    <div className="relative mx-auto w-full max-w-3xl">
      <div
        className={cn("timeline-dot", visible && "revealed")}
        style={{ top: "28px" }}
        aria-hidden="true"
      />

      <div
        ref={ref}
        className={cn(
          "scroll-reveal flex",
          ALIGN_CLASS[side],
          visible && DIRECTION_CLASS[side]
        )}
      >
        {children}
      </div>
    </div>
  );
}

type TimelineSpatialProps = {
  postElementByPostId?: Record<string, string>;
  connectFromId?: string | null;
  onSpatialElementClick?: (elementId: string) => void;
  registerSpatialAnchor?: (elementId: string, getRect: () => DOMRect | null) => () => void;
};

export function Timeline({
  posts,
  currentUserId,
  postElementByPostId = {},
  connectFromId = null,
  onSpatialElementClick,
  registerSpatialAnchor,
  emptyMessage,
  works = [],
  renderWork,
}: {
  posts: TimelinePost[];
  currentUserId: string;
  emptyMessage?: string;
  works?: WorkSnapshot[];
  renderWork?: (work: WorkSnapshot) => React.ReactNode;
} & TimelineSpatialProps) {
  const sorted = useMemo(
    () => posts.filter(post => post.type !== "agent_log").sort(compareTimelinePosts),
    [posts]
  );
  const entries = useMemo<TimelineEntry[]>(
    () =>
      [...sorted.map((post) => ({
        kind: "post" as const,
        id: post.id,
        sortAt: new Date(post.publishedAt).getTime(),
        post,
      })), ...works.map(work => ({ kind: "work" as const, id: work.id, sortAt: new Date(work.publishedAt!).getTime(), work }))].sort((a, b) => a.sortAt - b.sortAt || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : 1)),
    [sorted, works]
  );

  const humanAuthors = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const p of sorted) {
      if (p.type === "user_post" && p.authorId && !seen.has(p.authorId)) {
        ids.push(p.authorId);
        seen.add(p.authorId);
      }
    }
    return ids;
  }, [sorted]);

  const leftUserId = humanAuthors[0] ?? currentUserId;
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-black/40 text-sm">{emptyMessage ?? "No moments yet."}</p>
        {!emptyMessage && (
          <p className="text-black/30 text-xs mt-1">
            Write your first post or publish a spatial work.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="timeline-line" aria-hidden="true" />

      <div className="flex flex-col gap-10">
        {entries.map((entry) => {
          if (entry.kind === "work") return <div key={entry.id} className="work-timeline-row">{renderWork?.(entry.work)}</div>;
          const post = entry.post;

          const isLeft = post.authorId === leftUserId;
          const elementId = postElementByPostId[post.id];

          return (
            <div key={post.id}>
              <TimelineItem side={isLeft ? "left" : "right"}>
                <PostCardSpatialShell
                  elementId={elementId}
                  label={`连接博文：${post.title}`}
                  isConnectFrom={connectFromId === elementId}
                  onSpatialClick={onSpatialElementClick}
                  registerSpatialAnchor={registerSpatialAnchor}
                >
                  <PostCard
                    post={post}
                    isOwner={post.authorId === currentUserId}
                  />
                </PostCardSpatialShell>
              </TimelineItem>
            </div>
          );
        })}
      </div>
    </div>
  );
}
