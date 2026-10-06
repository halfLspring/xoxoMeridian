import React from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeTimelineBoard } from "@/components/home/HomeTimelineBoard";
import { prisma } from "@/lib/prisma";
import {
  createTestRoom,
  createTestUser,
  resetTestDatabase,
} from "@/tests/integration/support/database";

const authState = vi.hoisted(() => ({ currentUserId: "" }));

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(async () => ({ id: authState.currentUserId })),
  requirePageUser: vi.fn(async () => ({
    id: authState.currentUserId,
    displayName: "Visibility viewer",
    avatarLabel: "V",
    profile: null,
  })),
}));

import HomePage from "@/app/home/page";
import { GET as getPostDetail } from "@/app/api/posts/[slug]/route";
import { GET as listPosts } from "@/app/api/posts/route";

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function findElementByType(
  node: React.ReactNode,
  type: React.ElementType,
): React.ReactElement<{ posts: Array<{ slug: string }> }> | null {
  if (!React.isValidElement(node)) return null;
  if (node.type === type) {
    return node as React.ReactElement<{ posts: Array<{ slug: string }> }>;
  }

  const element = node as React.ReactElement<{ children?: React.ReactNode }>;
  for (const child of React.Children.toArray(element.props.children)) {
    const match = findElementByType(child, type);
    if (match) return match;
  }

  return null;
}

async function createVisibilityFixtures() {
  const [userA, userB] = await Promise.all([
    createTestUser({ id: "post-visibility-user-a" }),
    createTestUser({ id: "post-visibility-user-b" }),
  ]);
  const [roomA, roomB, deletedRoom] = await Promise.all([
    createTestRoom({ id: "post-visibility-room-a" }),
    createTestRoom({ id: "post-visibility-room-b" }),
    createTestRoom({ id: "post-visibility-room-deleted" }),
  ]);

  await prisma.roomParticipant.createMany({
    data: [
      { roomId: roomA.id, userId: userA.id },
      { roomId: roomB.id, userId: userB.id },
    ],
  });
  await prisma.post.createMany({
    data: [
      {
        id: "global-user-post",
        slug: "global-user-post",
        title: "Global shared story",
        content: "This user post remains globally visible.",
        type: "user_post",
        authorId: userB.id,
        roomId: roomB.id,
        publishedAt: new Date("2026-09-08T10:00:00.000Z"),
      },
      {
        id: "room-a-agent-log",
        slug: "room-a-agent-log",
        title: "Room A agent result",
        content: "Only room A members may read this result.",
        type: "agent_log",
        roomId: roomA.id,
        publishedAt: new Date("2026-09-08T10:01:00.000Z"),
      },
      {
        id: "room-b-agent-log",
        slug: "room-b-secret-agent-log",
        title: "Room B secret agent result",
        content: "Only room B members may read this secret.",
        type: "agent_log",
        roomId: roomB.id,
        publishedAt: new Date("2026-09-08T10:02:00.000Z"),
      },
      {
        id: "orphan-agent-log",
        slug: "orphan-agent-log",
        title: "Deleted room agent result",
        content: "This must not become global after Room deletion.",
        type: "agent_log",
        roomId: deletedRoom.id,
        publishedAt: new Date("2026-09-08T10:03:00.000Z"),
      },
    ],
  });
  await prisma.room.delete({ where: { id: deletedRoom.id } });

  return { userA, userB };
}

async function getListedSlugs(url: string) {
  const response = await listPosts(new Request(url));
  expect(response.status).toBe(200);
  const body = await response.json();
  return (body.posts as Array<{ slug: string }>).map((post) => post.slug).sort();
}

describe("Post room visibility", () => {
  it("普通文章保持全局可见，首页排除日志且独立列表与详情仍执行房间权限", async () => {
    const { userA, userB } = await createVisibilityFixtures();
    authState.currentUserId = userA.id;

    await expect(getListedSlugs("http://localhost/api/posts")).resolves.toEqual([
      "global-user-post",
      "room-a-agent-log",
    ]);
    await expect(
      getListedSlugs("http://localhost/api/posts?type=agent_log"),
    ).resolves.toEqual(["room-a-agent-log"]);
    await expect(
      getListedSlugs("http://localhost/api/posts?q=Room%20B%20secret"),
    ).resolves.toEqual([]);

    const visibleDetail = await getPostDetail(
      new Request("http://localhost/api/posts/room-a-agent-log"),
      { params: Promise.resolve({ slug: "room-a-agent-log" }) },
    );
    const hiddenDetail = await getPostDetail(
      new Request("http://localhost/api/posts/room-b-secret-agent-log"),
      { params: Promise.resolve({ slug: "room-b-secret-agent-log" }) },
    );
    const orphanDetail = await getPostDetail(
      new Request("http://localhost/api/posts/orphan-agent-log"),
      { params: Promise.resolve({ slug: "orphan-agent-log" }) },
    );
    const globalDetail = await getPostDetail(
      new Request("http://localhost/api/posts/global-user-post"),
      { params: Promise.resolve({ slug: "global-user-post" }) },
    );

    expect(visibleDetail.status).toBe(200);
    expect(hiddenDetail.status).toBe(404);
    expect(orphanDetail.status).toBe(404);
    expect(globalDetail.status).toBe(200);
    await expect(
      prisma.post.findUniqueOrThrow({ where: { id: "orphan-agent-log" } }),
    ).resolves.toMatchObject({ type: "agent_log", roomId: null });

    const homeElement = await HomePage();
    const homeTimeline = findElementByType(homeElement, HomeTimelineBoard);
    expect(homeTimeline).not.toBeNull();
    expect(homeTimeline?.props.posts.map((post) => post.slug).sort()).toEqual([
      "global-user-post",
    ]);

    authState.currentUserId = userB.id;
    await expect(getListedSlugs("http://localhost/api/posts")).resolves.toEqual([
      "global-user-post",
      "room-b-secret-agent-log",
    ]);
    const partnerHome = findElementByType(await HomePage(), HomeTimelineBoard);
    expect(partnerHome?.props.posts.map(post => post.slug)).toEqual(["global-user-post"]);
  });
});
