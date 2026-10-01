import type { Prisma } from "@prisma/client";

export function getPostVisibilityWhere(userId: string): Prisma.PostWhereInput {
  return {
    publishedAt: { not: null },
    AND: [{ OR: [{ workId: null }, { work: { is: { status: "published" } } }] }],
    OR: [
      { type: "user_post" },
      {
        type: "agent_log",
        roomId: { not: null },
        room: {
          participants: {
            some: { userId },
          },
        },
      },
    ],
  };
}
