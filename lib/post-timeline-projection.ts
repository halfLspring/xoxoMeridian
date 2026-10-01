import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { postTimelineSelect } from "@/lib/post-timeline";

type TimelineRow = Prisma.PostGetPayload<{ select: typeof postTimelineSelect }>;

function agentLogTaskId(post: TimelineRow): string | null {
  if (post.type !== "agent_log") return null;
  if (post.agentTaskId) return post.agentTaskId;
  const metadata = post.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return typeof metadata.taskId === "string" ? metadata.taskId : null;
}

// Post.authorId 表示文章作者与编辑权限，不承载 Agent 指令发起者。旧日志没有
// agentTaskId 外键，但 metadata.taskId 保留了任务 ID；两种记录由同一批查询解析。
export async function projectTimelinePosts(posts: TimelineRow[]) {
  const taskIdByPostId = new Map(posts.map((post) => [post.id, agentLogTaskId(post)]));
  const taskIds = [...new Set([...taskIdByPostId.values()].filter((id): id is string => id !== null))];
  const tasks = taskIds.length > 0
    ? await prisma.agentTask.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, roomId: true, requestedById: true },
    })
    : [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  return posts.map(({ roomId, agentTaskId, ...post }) => {
    if (!post.publishedAt) throw new Error("Unpublished post in public projection");
    const taskId = agentTaskId ?? taskIdByPostId.get(post.id);
    const task = taskId ? taskById.get(taskId) : null;
    return {
      ...post,
      agentRequesterId: post.type === "agent_log" && task?.roomId === roomId
        ? task.requestedById
        : null,
    };
  });
}
