import React from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeTimelineBoard } from "@/components/home/HomeTimelineBoard";
import type { TimelinePost } from "@/components/blog/Timeline";
import { resolveAuthorLocation } from "@/lib/post-time";
import { prisma } from "@/lib/prisma";
import { createTestRoom, createTestUser, resetTestDatabase } from "@/tests/integration/support/database";

const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/auth", () => ({
  requireCurrentUser: async () => ({ id: auth.userId }),
  requirePageUser: async () => ({ id: auth.userId, displayName: "读者", avatarLabel: "读", profile: null }),
}));

import HomePage from "@/app/home/page";
import { GET } from "@/app/api/posts/route";
import { GET as GETFeed } from "@/app/api/blog/feed/route";

function timelinePosts(node: React.ReactNode): TimelinePost[] | null {
  if (!React.isValidElement(node)) return null;
  if (node.type === HomeTimelineBoard) return (node.props as { posts: TimelinePost[] }).posts;
  for (const child of React.Children.toArray((node.props as { children?: React.ReactNode }).children)) {
    const posts = timelinePosts(child);
    if (posts) return posts;
  }
  return null;
}

beforeEach(resetTestDatabase);
afterAll(async () => { await prisma.$disconnect(); });

describe("首页专用读取与独立 Post 展示投影", () => {
  it("真实查询返回相同最小字段、位置快照/fallback 和成员可见集合，排除私有档案", async () => {
    const [author, noProfile, outsider] = await Promise.all([
      createTestUser(), createTestUser(), createTestUser(),
    ]);
    const profile = { city: "Tokyo", country: "Japan", timezone: "Asia/Tokyo" };
    const snapshot = { city: "London", country: "United Kingdom", timezone: "Europe/London" };
    await prisma.userProfile.create({ data: {
      userId: author.id, ...profile, lastGeoIp: "192.0.2.10", profileNote: "仅供本人查看的档案",
      preferences: { privateSentinel: "private-preferences" },
    } });
    const room = await createTestRoom();
    await prisma.roomParticipant.create({ data: { roomId: room.id, userId: author.id } });
    const records = [
      { id: "legacy", type: "user_post" as const, authorId: author.id },
      {
        id: "snapshot", type: "user_post" as const, authorId: author.id,
        authorCity: snapshot.city, authorCountry: snapshot.country, authorTimezone: snapshot.timezone,
      },
      { id: "no-profile", type: "user_post" as const, authorId: noProfile.id },
      { id: "no-author", type: "user_post" as const },
      { id: "member-log", type: "agent_log" as const, roomId: room.id, metadata: { thought: "成员可见内容" } },
      { id: "orphan-log", type: "agent_log" as const },
    ];
    await prisma.post.createMany({ data: records.map((post, index) => ({
      ...post, slug: post.id, title: `投影 ${post.id}`, content: `内容 ${post.id}`,
      publishedAt: new Date(Date.UTC(2026, 8, 13, index)),
    })) });

    for (const viewer of [author, outsider]) {
      auth.userId = viewer.id;
      const response = await GET(new Request("http://localhost/api/posts?q=%E6%8A%95%E5%BD%B1"));
      expect(response.status).toBe(200);
      const { posts: searched } = await response.json() as { posts: TimelinePost[] };
      const home = timelinePosts(await HomePage());
      expect(home).not.toBeNull();
      const feedResponse = await GETFeed(new Request("http://localhost/api/blog/feed?q=投影"));
      expect(feedResponse.status).toBe(200);
      const feed = await feedResponse.json();
      expect(feed.entries.map((entry: { post: TimelinePost }) => entry.post)).toEqual(home);
      expect(searched.filter(post => post.type !== "agent_log")).toEqual(home);
      expect(searched.map((post) => post.id).sort()).toEqual([
        "legacy", "no-author", "no-profile", "snapshot", ...(viewer.id === author.id ? ["member-log"] : []),
      ].sort());

      for (const post of searched) {
        expect(Object.keys(post).sort()).toEqual([
          "id", "slug", "title", "content", "type", "authorId", "authorCity", "authorCountry",
          "authorTimezone", "publishedAt", "metadata", "author", "agentRequesterId",
        ].sort());
        if (post.author) {
          expect(Object.keys(post.author).sort()).toEqual(["id", "displayName", "avatarLabel", "profile"].sort());
          if (post.author.profile) expect(post.author.profile).toEqual(profile);
        }
      }
      const byId = new Map(searched.map((post) => [post.id, post]));
      expect(resolveAuthorLocation(byId.get("legacy")!)).toEqual(profile);
      expect(resolveAuthorLocation(byId.get("snapshot")!)).toEqual(snapshot);
      expect(byId.get("no-profile")?.author?.profile).toBeNull();
      expect(byId.get("no-author")?.author).toBeNull();
      expect(JSON.stringify(searched)).not.toMatch(/privateSentinel|private-preferences|192\.0\.2\.10|仅供本人查看的档案|passwordHash|sessionVersion/);
    }
  });

  it("首页排除新旧/失联/无发起者日志，独立日志 API 仍解析归属并执行成员权限", async () => {
    const [first, second] = await Promise.all([createTestUser(), createTestUser()]);
    const [room, otherRoom] = await Promise.all([createTestRoom(), createTestRoom()]);
    await prisma.roomParticipant.createMany({ data: [
      { roomId: room.id, userId: first.id },
      { roomId: room.id, userId: second.id },
    ] });
    const agent = await prisma.agent.create({ data: {
      slug: "timeline-agent", displayName: "时间线助手", description: "测试助手",
    } });
    const createTask = (roomId: string, requestedById: string | null) => prisma.agentTask.create({ data: {
      roomId, agentId: agent.id, requestedById, status: "completed", input: {},
    } });
    const [newTask, oldTask, partnerTask, scheduledTask, foreignTask] = await Promise.all([
      createTask(room.id, first.id),
      createTask(room.id, first.id),
      createTask(room.id, second.id),
      createTask(room.id, null),
      createTask(otherRoom.id, second.id),
    ]);
    const records = [
      { id: "new-log", taskId: newTask.id, agentTaskId: newTask.id },
      { id: "legacy-log", taskId: oldTask.id },
      { id: "partner-log", taskId: partnerTask.id, agentTaskId: partnerTask.id },
      { id: "scheduled-log", taskId: scheduledTask.id, agentTaskId: scheduledTask.id },
      { id: "foreign-log", taskId: foreignTask.id },
      { id: "missing-log", taskId: "missing-task" },
    ];
    await prisma.post.createMany({ data: records.map((record, index) => ({
      id: record.id, slug: record.id, title: `归属验证 ${record.id}`,
      content: "Agent 日志归属", type: "agent_log", roomId: room.id,
      agentTaskId: record.agentTaskId, metadata: { taskId: record.taskId },
      publishedAt: new Date(Date.UTC(2026, 8, 23, index)),
    })) });

    auth.userId = first.id;
    const response = await GET(new Request("http://localhost/api/posts?q=归属验证"));
    expect(response.status).toBe(200);
    const searched = (await response.json() as { posts: TimelinePost[] }).posts;
    const home = timelinePosts(await HomePage());
    expect(home).toEqual([]);
    const feedResponse = await GETFeed(new Request("http://localhost/api/blog/feed?q=归属验证"));
    expect(feedResponse.status).toBe(200);
    expect(await feedResponse.json()).toEqual({ entries: [], nextCursor: null });
    const requesterById = new Map(searched.map((post) => [post.id, post.agentRequesterId]));
    expect(Object.fromEntries(requesterById)).toEqual({
      "new-log": first.id,
      "legacy-log": first.id,
      "partner-log": second.id,
      "scheduled-log": null,
      "foreign-log": null,
      "missing-log": null,
    });
    expect(searched.every((post) => !("roomId" in post) && !("agentTaskId" in post))).toBe(true);
    expect(searched.every((post) => post.authorId === null)).toBe(true);
    auth.userId = (await createTestUser()).id;
    const outsiderResponse = await GET(new Request("http://localhost/api/posts?type=agent_log&q=归属验证"));
    expect(outsiderResponse.status).toBe(200);
    expect((await outsiderResponse.json()).posts).toEqual([]);
  });
});
