import type { AtlasConnectionData, AtlasElementData } from "@/components/atlas/types";
import type { WorkWindow } from "@/lib/blog-work/schemas";
import type { TimelinePost } from "@/components/blog/Timeline";

export type WorkPost = { id: string; slug: string | null; title: string; content: string; workOrder: number; publishedAt: string | null; authorTimezone?: string | null; elementId: string };
export type WorkElement = AtlasElementData & { postId: string | null; workId: string };
export type WorkSnapshot = WorkWindow & {
  id: string; ownerId: string; ownerName: string; status: "draft" | "published"; revision: number;
  layoutWidth: number; draftX?: number; draftY?: number; publishedAt: string | null; updatedAt: string;
  canManage: boolean; posts: WorkPost[]; elements: WorkElement[];
  connections: Array<AtlasConnectionData & { workId: string }>;
};
export type BlogFeedEntry = { kind: "post"; post: TimelinePost } | { kind: "work"; work: WorkSnapshot; matchedElementIds?: string[] };
export type BlogFeed = { entries: BlogFeedEntry[]; nextCursor: string | null };
export type DraftSummary = { id: string; title: string; updatedAt: string; authorTimezone?: string | null; thumbnail: string | null; revision: number };
