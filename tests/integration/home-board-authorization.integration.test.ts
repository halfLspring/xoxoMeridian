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
    displayName: "Home board viewer",
    avatarLabel: "H",
    profile: null,
  })),
}));

import HomePage from "@/app/home/page";
import { POST as createHomeConnection, DELETE as deleteHomeConnection } from "@/app/api/home-board/connections/route";
import { PATCH as patchHomeElement } from "@/app/api/home-board/elements/[elementId]/route";

type HomeTimelineBoardProps = {
  posts: Array<{ id: string }>;
  initialSnapshot: {
    elements: Array<{ id: string; postId: string | null }>;
    connections: Array<{ id: string; fromId: string; toId: string }>;
  };
};

function findElementByType(
  node: React.ReactNode,
  type: React.ElementType,
): React.ReactElement<HomeTimelineBoardProps> | null {
  if (!React.isValidElement(node)) return null;
  if (node.type === type) {
    return node as React.ReactElement<HomeTimelineBoardProps>;
  }

  const element = node as React.ReactElement<{ children?: React.ReactNode }>;
  for (const child of React.Children.toArray(element.props.children)) {
    const match = findElementByType(child, type);
    if (match) return match;
  }

  return null;
}

function patchElement(elementId: string, data: Record<string, unknown>) {
  return patchHomeElement(
    new Request(`http://localhost/api/home-board/elements/${elementId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
    { params: Promise.resolve({ elementId }) },
  );
}

function createConnection(fromId: string, toId: string) {
  return createHomeConnection(new Request("http://localhost/api/home-board/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromId, toId }),
  }));
}

function deleteConnection(connectionId: string) {
  return deleteHomeConnection(new Request(
    `http://localhost/api/home-board/connections?id=${connectionId}`,
    { method: "DELETE" },
  ));
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Home board room-scoped anchor authorization", () => {
  it("hides inaccessible anchors and rejects their element and connection mutations", async () => {
    const [userA, userB] = await Promise.all([
      createTestUser({ id: "home-auth-user-a" }),
      createTestUser({ id: "home-auth-user-b" }),
    ]);
    const [roomA, roomB] = await Promise.all([
      createTestRoom({ id: "home-auth-room-a" }),
      createTestRoom({ id: "home-auth-room-b" }),
    ]);
    await prisma.roomParticipant.createMany({
      data: [
        { roomId: roomA.id, userId: userA.id },
        { roomId: roomB.id, userId: userB.id },
      ],
    });
    await prisma.atlasBoard.create({ data: { id: "home-board" } });

    await prisma.post.createMany({
      data: [
        {
          id: "home-auth-global-post",
          slug: "home-auth-global-post",
          title: "Global user post",
          content: "Visible to every authenticated user.",
          type: "user_post",
          authorId: userB.id,
          roomId: roomB.id,
          publishedAt: new Date("2026-09-12T01:00:00.000Z"),
        },
        {
          id: "home-auth-room-a-log",
          slug: "home-auth-room-a-log",
          title: "Room A log",
          content: "Visible to user A.",
          type: "agent_log",
          roomId: roomA.id,
          publishedAt: new Date("2026-09-12T01:01:00.000Z"),
        },
        {
          id: "home-auth-room-b-log",
          slug: "home-auth-room-b-log",
          title: "Room B hidden log",
          content: "Visible only to user B.",
          type: "agent_log",
          roomId: roomB.id,
          publishedAt: new Date("2026-09-12T01:02:00.000Z"),
        },
      ],
    });

    await prisma.atlasElement.createMany({
      data: [
        {
          id: "home-auth-global-anchor",
          boardId: "home-board",
          type: "note",
          postId: "home-auth-global-post",
          x: 10,
          y: 10,
        },
        {
          id: "home-auth-room-a-anchor",
          boardId: "home-board",
          type: "note",
          postId: "home-auth-room-a-log",
          x: 20,
          y: 20,
        },
        {
          id: "home-auth-room-b-anchor",
          boardId: "home-board",
          type: "note",
          postId: "home-auth-room-b-log",
          x: 30,
          y: 30,
        },
        {
          id: "home-auth-photo-one",
          boardId: "home-board",
          type: "photo",
          imageUrl: "/api/atlas/uploads/atlas%2Fhome-auth-one.jpg",
          x: 40,
          y: 40,
          createdById: userB.id,
        },
        {
          id: "home-auth-photo-two",
          boardId: "home-board",
          type: "photo",
          imageUrl: "/api/atlas/uploads/atlas%2Fhome-auth-two.jpg",
          x: 50,
          y: 50,
          createdById: userB.id,
        },
      ],
    });
    await prisma.atlasConnection.createMany({
      data: [
        {
          id: "home-auth-visible-connection",
          boardId: "home-board",
          fromId: "home-auth-global-anchor",
          toId: "home-auth-photo-one",
        },
        {
          id: "home-auth-hidden-connection",
          boardId: "home-board",
          fromId: "home-auth-room-b-anchor",
          toId: "home-auth-photo-one",
        },
      ],
    });

    authState.currentUserId = userA.id;
    const home = findElementByType(await HomePage(), HomeTimelineBoard);
    expect(home).not.toBeNull();
    expect(home?.props.posts.map((post) => post.id).sort()).toEqual([
      "home-auth-global-post",
      "home-auth-room-a-log",
    ]);
    const elementIds = home?.props.initialSnapshot.elements.map((element) => element.id).sort();
    const connectionIds = home?.props.initialSnapshot.connections.map((connection) => connection.id).sort();
    const patchStatus = (await patchElement("home-auth-room-b-anchor", { x: 999 })).status;
    const createStatus = (await createConnection("home-auth-room-b-anchor", "home-auth-photo-two")).status;
    const deleteStatus = (await deleteConnection("home-auth-hidden-connection")).status;
    const hiddenAnchor = await prisma.atlasElement.findUniqueOrThrow({
      where: { id: "home-auth-room-b-anchor" },
    });
    const hiddenConnection = await prisma.atlasConnection.findUnique({
      where: { id: "home-auth-hidden-connection" },
    });
    const unauthorizedConnectionCount = await prisma.atlasConnection.count({
      where: {
        boardId: "home-board",
        fromId: "home-auth-room-b-anchor",
        toId: "home-auth-photo-two",
      },
    });

    expect({
      elementIds,
      connectionIds,
      patchStatus,
      createStatus,
      deleteStatus,
      hiddenPosition: { x: hiddenAnchor.x, y: hiddenAnchor.y },
      hiddenConnectionExists: hiddenConnection !== null,
      unauthorizedConnectionCount,
    }).toEqual({
      elementIds: [
        "home-auth-global-anchor",
        "home-auth-photo-one",
        "home-auth-photo-two",
        "home-auth-room-a-anchor",
      ],
      connectionIds: ["home-auth-visible-connection"],
      patchStatus: 404,
      createStatus: 404,
      deleteStatus: 404,
      hiddenPosition: { x: 30, y: 30 },
      hiddenConnectionExists: true,
      unauthorizedConnectionCount: 0,
    });

    expect((await patchElement("home-auth-global-anchor", { x: 110 })).status).toBe(200);
    expect((await patchElement("home-auth-photo-one", { x: 140 })).status).toBe(200);

    authState.currentUserId = userB.id;
    expect((await patchElement("home-auth-room-b-anchor", { x: 130 })).status).toBe(200);
    expect((await createConnection("home-auth-room-b-anchor", "home-auth-photo-two")).status).toBe(201);
    expect((await deleteConnection("home-auth-hidden-connection")).status).toBe(200);
  });

  it("persists photo rotation within 25 degrees and rejects larger or non-photo rotation", async () => {
    const user = await createTestUser({ id: "home-rotation-user" });
    authState.currentUserId = user.id;
    await prisma.atlasBoard.create({ data: { id: "home-board" } });
    const post = await prisma.post.create({
      data: {
        slug: "home-rotation-post",
        title: "Home rotation post",
        content: "An anchor must remain unrotated.",
        type: "user_post",
        authorId: user.id,
        publishedAt: new Date("2026-09-29T00:00:00.000Z"),
      },
    });
    await prisma.atlasElement.createMany({
      data: [
        {
          id: "home-rotation-photo",
          boardId: "home-board",
          type: "photo",
          imageUrl: "/brand/logo_white.svg",
          x: 20,
          y: 30,
          createdById: user.id,
        },
        {
          id: "home-rotation-anchor",
          boardId: "home-board",
          type: "note",
          postId: post.id,
          x: 40,
          y: 50,
          createdById: user.id,
        },
      ],
    });

    expect((await patchElement("home-rotation-photo", { rotation: 25 })).status).toBe(200);
    expect((await prisma.atlasElement.findUniqueOrThrow({ where: { id: "home-rotation-photo" } })).rotation).toBe(25);
    expect((await patchElement("home-rotation-photo", { rotation: -25 })).status).toBe(200);
    expect((await prisma.atlasElement.findUniqueOrThrow({ where: { id: "home-rotation-photo" } })).rotation).toBe(-25);

    for (const rotation of [25.1, -25.1, "10", null]) {
      expect((await patchElement("home-rotation-photo", { rotation })).status).toBe(400);
      expect((await prisma.atlasElement.findUniqueOrThrow({ where: { id: "home-rotation-photo" } })).rotation).toBe(-25);
    }
    expect((await patchElement("home-rotation-anchor", { rotation: 10 })).status).toBe(400);
    expect((await prisma.atlasElement.findUniqueOrThrow({ where: { id: "home-rotation-anchor" } })).rotation).toBe(0);
  });
});
