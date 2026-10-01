import type { Prisma } from "@prisma/client";

import { getPostVisibilityWhere } from "@/lib/post-visibility";
import { prisma } from "@/lib/prisma";

export const HOME_BOARD_ID = "home-board";

type HomePostInput = {
  id: string;
  authorId: string | null;
};

type HomeBoardAccessScope = {
  boardId: string;
  userId: string;
};

const FOREIGN_KEY_VIOLATION = "P2003";
const UNIQUE_VIOLATION = "P2002";

function isPrismaErrorCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

function toHomePostElement(boardId: string, post: HomePostInput) {
  return {
    boardId,
    type: "note" as const,
    postId: post.id,
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    rotation: 0,
    zIndex: 0,
    createdById: post.authorId,
  };
}

export function getHomeBoardElementAccessWhere({
  boardId,
  userId,
}: HomeBoardAccessScope): Prisma.AtlasElementWhereInput {
  return {
    boardId,
    workId: null,
    OR: [
      { type: "photo", postId: null },
      {
        post: {
          is: getPostVisibilityWhere(userId),
        },
      },
    ],
  };
}

export function getHomeBoardConnectionAccessWhere({
  boardId,
  userId,
}: HomeBoardAccessScope): Prisma.AtlasConnectionWhereInput {
  const elementWhere = getHomeBoardElementAccessWhere({ boardId, userId });

  return {
    boardId,
    workId: null,
    fromEl: { is: elementWhere },
    toEl: { is: elementWhere },
  };
}

export async function getOrCreateHomeBoard() {
  return prisma.atlasBoard.upsert({
    where: { id: HOME_BOARD_ID },
    update: {},
    create: { id: HOME_BOARD_ID },
  });
}

export async function ensureHomePostElements({
  boardId,
  posts,
}: {
  boardId: string;
  posts: HomePostInput[];
}) {
  if (posts.length === 0) return;

  const existing = await prisma.atlasElement.findMany({
    where: {
      boardId,
      postId: { in: posts.map((post) => post.id) },
    },
    select: { postId: true },
  });

  const existingPostIds = new Set(existing.map((element) => element.postId).filter(Boolean));
  const missing = posts.filter((post) => !existingPostIds.has(post.id));

  if (missing.length === 0) return;

  try {
    await prisma.atlasElement.createMany({
      data: missing.map((post) => toHomePostElement(boardId, post)),
      skipDuplicates: true,
    });
  } catch (error) {
    if (!isPrismaErrorCode(error, FOREIGN_KEY_VIOLATION)) throw error;

    await anchorPostsAfterInterleavedDeletion(boardId, missing);
  }
}

/**
 * anchor 是 Post 的派生投影，Post 可能在首页读取与本函数写入之间被删除，
 * 此时外键会拒绝整批写入。逐条补写让每个 anchor 独立落库：读取后已不存在的
 * Post 只跳过它自己，同批其余 anchor 照常建立；无法归因到删除的错误继续上抛。
 */
async function anchorPostsAfterInterleavedDeletion(boardId: string, posts: HomePostInput[]) {
  for (const post of posts) {
    try {
      await prisma.atlasElement.create({ data: toHomePostElement(boardId, post) });
    } catch (error) {
      if (isPrismaErrorCode(error, UNIQUE_VIOLATION)) continue;

      if (isPrismaErrorCode(error, FOREIGN_KEY_VIOLATION)) {
        const deleted = await prisma.post.findUnique({
          where: { id: post.id },
          select: { id: true },
        });
        if (deleted === null) continue;
      }

      throw error;
    }
  }
}

export async function getHomeBoardSnapshot({ boardId, userId }: HomeBoardAccessScope) {
  const elementWhere = getHomeBoardElementAccessWhere({ boardId, userId });
  const connectionWhere = getHomeBoardConnectionAccessWhere({ boardId, userId });
  const [elements, connections] = await Promise.all([
    prisma.atlasElement.findMany({
      where: elementWhere,
      orderBy: { zIndex: "asc" },
    }),
    prisma.atlasConnection.findMany({
      where: connectionWhere,
    }),
  ]);

  return { boardId, elements, connections };
}
