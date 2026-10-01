import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPostFindMany, mockPostFindFirst, mockPostFindUnique, mockPostCreate, mockPostUpdate, mockPostDelete } = vi.hoisted(() => ({
  mockPostFindMany: vi.fn(),
  mockPostFindFirst: vi.fn(),
  mockPostFindUnique: vi.fn(),
  mockPostCreate: vi.fn(),
  mockPostUpdate: vi.fn(),
  mockPostDelete: vi.fn(),
}));

const { mockRequireCurrentUser } = vi.hoisted(() => ({
  mockRequireCurrentUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const client = {

    post: {
      findMany: mockPostFindMany,
      findFirst: mockPostFindFirst,
      findUnique: mockPostFindUnique,
      create: mockPostCreate,
      update: mockPostUpdate,
      delete: mockPostDelete,
    },
    atlasBoard: { upsert: vi.fn(async () => ({ id: "home-board" })) },
    blogWork: { create: vi.fn(async () => ({ id: "work-1" })), update: vi.fn() },
    atlasElement: { create: vi.fn() },
  };
  return { prisma: { ...client, $transaction: vi.fn(async fn => fn(client)) } };
});

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: mockRequireCurrentUser,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { GET, POST } from "@/app/api/posts/route";
import { GET as GET_POST_DETAIL } from "@/app/api/posts/[slug]/route";

beforeEach(() => {
  vi.clearAllMocks();
});

function expectRoomScopedAgentLogVisibility(where: Record<string, unknown>) {
  expect(where).toEqual(
    expect.objectContaining({
      AND: [
        expect.objectContaining({
          OR: [
            { type: "user_post" },
            {
              type: "agent_log",
              roomId: { not: null },
              room: { participants: { some: { userId: "user-1" } } },
            },
          ],
          publishedAt: { not: null },
        }),
      ],
    }),
  );
}

describe("GET /api/posts", () => {
  it("requires authentication", async () => {
    mockRequireCurrentUser.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    const response = await GET(new Request("http://localhost/api/posts"));
    expect(response.status).toBe(401);
  });

  it("成功无匹配返回空集合；数据库失败保持非成功状态", async () => {
    mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
    mockPostFindMany.mockResolvedValueOnce([]);
    const empty = await GET(new Request("http://localhost/api/posts?q=missing"));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ posts: [], nextCursor: null });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockPostFindMany.mockRejectedValueOnce(new Error("database unavailable"));
      const failed = await GET(new Request("http://localhost/api/posts?q=missing"));
      expect(failed.status).toBe(500);
      expect(await failed.json()).not.toHaveProperty("posts");
    } finally {
      log.mockRestore();
    }
  });

  it("returns posts with author info", async () => {
    mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
    mockPostFindMany.mockResolvedValue([
      {
        id: "post-1",
        slug: "hello-world",
        title: "Hello World",
        content: "Test content",
        type: "user_post",
        authorId: "user-1",
        publishedAt: new Date(),
        author: { id: "user-1", displayName: "Alice", avatarLabel: "A" },
      },
    ]);

    const response = await GET(new Request("http://localhost/api/posts"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].slug).toBe("hello-world");
  });

  it("respects type filter", async () => {
    mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
    mockPostFindMany.mockResolvedValue([]);

    const response = await GET(new Request("http://localhost/api/posts?type=agent_log"));
    expect(response.status).toBe(200);
    const { where } = mockPostFindMany.mock.calls[0][0];
    expect(where).toEqual(expect.objectContaining({ type: "agent_log" }));
    expectRoomScopedAgentLogVisibility(where);
  });

  const cursorPayload = { v: 1, publishedAt: "2026-09-13T01:02:03.123Z", id: "cpostcursor" };
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

  it.each([
    ["旧时间字符串", cursorPayload.publishedAt],
    ["空字符串", ""],
    ["空白", " "],
    ["非法编码", "%%%"],
    ["非规范编码", "Zh"],
    ["Base64 padding", `${encoded(cursorPayload)}=`],
    ["过长游标", "a".repeat(1025)],
    ["非法 JSON", Buffer.from("{").toString("base64url")],
    ["null", encoded(null)],
    ["数组", encoded([cursorPayload.publishedAt, cursorPayload.id])],
    ["缺少版本", encoded({ publishedAt: cursorPayload.publishedAt, id: cursorPayload.id })],
    ["未知版本", encoded({ ...cursorPayload, v: 2 })],
    ["缺少 ID", encoded({ v: 1, publishedAt: cursorPayload.publishedAt })],
    ["空 ID", encoded({ ...cursorPayload, id: "" })],
    ["非字符串 ID", encoded({ ...cursorPayload, id: 123 })],
    ["空白 ID", encoded({ ...cursorPayload, id: " " })],
    ["控制字符 ID", encoded({ ...cursorPayload, id: "post\u0000id" })],
    ["过长 ID", encoded({ ...cursorPayload, id: "a".repeat(129) })],
    ["非法日期", encoded({ ...cursorPayload, publishedAt: "2026-02-30T00:00:00.000Z" })],
    ["非毫秒日期", encoded({ ...cursorPayload, publishedAt: "2026-09-13T01:02:03Z" })],
    ["非字符串日期", encoded({ ...cursorPayload, publishedAt: 123 })],
    ["多余字段", encoded({ ...cursorPayload, extra: true })],
  ])("%s cursor 返回稳定 400 验证错误，不执行 Post 查询", async (_label, cursor) => {
    mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
    mockPostFindMany.mockResolvedValue([]);
    const response = await GET(new Request(`http://localhost/api/posts?${new URLSearchParams({ cursor })}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Invalid request", issues: expect.arrayContaining([expect.objectContaining({ path: "cursor", message: expect.any(String) })]),
    });
    expect(mockPostFindMany).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "1.5", "NaN", "Infinity", "10oops"])("limit=%s 返回 400，避免非正数或无效页大小进入分页", async (limit) => {
    mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
    mockPostFindMany.mockResolvedValue([]);
    const response = await GET(new Request(`http://localhost/api/posts?${new URLSearchParams({ limit })}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Invalid request", issues: [expect.objectContaining({ path: "limit" })],
    });
    expect(mockPostFindMany).not.toHaveBeenCalled();
  });

  it("同一毫秒的不同末项生成不同不透明 cursor，返回值可直接作为下一页请求", async () => {
    mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
    const cursors: string[] = [];
    for (const id of ["cposta", "cpostb"]) {
      mockPostFindMany.mockResolvedValueOnce([{ id, publishedAt: new Date(cursorPayload.publishedAt) }]);
      const first = await GET(new Request("http://localhost/api/posts?limit=1"));
      expect(first.status).toBe(200);
      const body = await first.json();
      expect(body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
      cursors.push(body.nextCursor);
      mockPostFindMany.mockResolvedValueOnce([]);
      const next = await GET(new Request(`http://localhost/api/posts?${new URLSearchParams({ cursor: body.nextCursor })}`));
      expect(next.status).toBe(200);
      expect(await next.json()).toEqual({ posts: [], nextCursor: null });
    }
    expect(new Set(cursors).size).toBe(2);
  });
});

describe("POST /api/posts", () => {
  it("requires title and content", async () => {
    mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
    const response = await POST(
      new Request("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "", content: "" }),
      })
    );
    expect(response.status).toBe(400);
  });

  it("creates a post with generated slug", async () => {
    mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
    mockPostCreate.mockResolvedValue({
      id: "post-new",
      slug: "my-first-post",
      title: "My First Post",
      content: "Hello world",
      type: "user_post",
      authorId: "user-1",
    });

    const response = await POST(
      new Request("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "My First Post", content: "Hello world" }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.post.slug).toBe("my-first-post");
  });

  it("slug 被并发占用时按后缀重试并返回顺延后的 slug", async () => {
    mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
    mockPostCreate
      .mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed on the fields: (`slug`)"), {
          code: "P2002",
          meta: { modelName: "Post", target: ["slug"] },
        })
      )
      .mockResolvedValueOnce({
        id: "post-new",
        slug: "my-first-post-2",
        title: "My First Post",
        content: "Hello world",
        type: "user_post",
        authorId: "user-1",
      });

    const response = await POST(
      new Request("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "My First Post", content: "Hello world" }),
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.post.slug).toBe("my-first-post-2");
    expect(mockPostCreate).toHaveBeenCalledTimes(2);
    expect(mockPostCreate.mock.calls.map(([args]) => args.data.slug)).toEqual([
      "my-first-post",
      "my-first-post-2",
    ]);
  });

  it("非冲突数据库错误不重试并保持失败响应", async () => {
    mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
    mockPostCreate.mockRejectedValue(
      Object.assign(new Error("Can't reach database server"), { code: "P1001" })
    );

    const response = await POST(
      new Request("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "My First Post", content: "Hello world" }),
      })
    );

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(mockPostCreate).toHaveBeenCalledTimes(1);
  });

  it("writes authorCity, authorCountry, authorTimezone from user profile on create", async () => {
    mockRequireCurrentUser.mockResolvedValue({
      id: "user-1",
      profile: { city: "Tokyo", country: "Japan", timezone: "Asia/Tokyo" },
    });
    mockPostCreate.mockResolvedValue({
      id: "post-new",
      slug: "hello",
      title: "Hello",
      content: "World",
      type: "user_post",
      authorId: "user-1",
      authorCity: "Tokyo",
      authorCountry: "Japan",
      authorTimezone: "Asia/Tokyo",
    });

    await POST(
      new Request("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "Hello", content: "World" }),
      })
    );

    expect(mockPostCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authorCity: "Tokyo",
          authorCountry: "Japan",
          authorTimezone: "Asia/Tokyo",
        }),
      })
    );
  });

  it("writes null location fields when user has no profile", async () => {
    mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
    mockPostCreate.mockResolvedValue({
      id: "post-new",
      slug: "hello",
      title: "Hello",
      content: "World",
      type: "user_post",
      authorId: "user-1",
    });

    await POST(
      new Request("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: "Hello", content: "World" }),
      })
    );

    expect(mockPostCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authorCity: null,
          authorCountry: null,
          authorTimezone: null,
        }),
      })
    );
  });
});

describe("GET /api/posts?q= search", () => {
    it("adds OR condition for title and content when q is present", async () => {
      mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
      mockPostFindMany.mockResolvedValue([]);

      await GET(new Request("http://localhost/api/posts?q=docker"));

      const { where } = mockPostFindMany.mock.calls[0][0];
      expect(where).toEqual(
        expect.objectContaining({
          OR: [
            { title: { contains: "docker", mode: "insensitive" } },
            { content: { contains: "docker", mode: "insensitive" } },
          ],
        }),
      );
      expectRoomScopedAgentLogVisibility(where);
    });

    it("treats empty q same as no q", async () => {
      mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
      mockPostFindMany.mockResolvedValue([]);

      await GET(new Request("http://localhost/api/posts?q="));

      const { where } = mockPostFindMany.mock.calls[0][0];
      expect(where.OR).toBeUndefined();
      expectRoomScopedAgentLogVisibility(where);
    });

    it("treats whitespace-only q same as no q", async () => {
      mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
      mockPostFindMany.mockResolvedValue([]);

      await GET(new Request("http://localhost/api/posts?q=   "));

      const { where } = mockPostFindMany.mock.calls[0][0];
      expect(where.OR).toBeUndefined();
      expectRoomScopedAgentLogVisibility(where);
    });

    it("combines q with type filter", async () => {
      mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
      mockPostFindMany.mockResolvedValue([]);

      await GET(new Request("http://localhost/api/posts?q=docker&type=user_post"));

      const { where } = mockPostFindMany.mock.calls[0][0];
      expect(where).toEqual(
        expect.objectContaining({
          type: "user_post",
          OR: [
            { title: { contains: "docker", mode: "insensitive" } },
            { content: { contains: "docker", mode: "insensitive" } },
          ],
        }),
      );
      expectRoomScopedAgentLogVisibility(where);
    });
  });

  describe("GET /api/posts/[slug]", () => {
  it("requires authentication before loading post details", async () => {
    mockRequireCurrentUser.mockRejectedValue(new Response("Unauthorized", { status: 401 }));

    const response = await GET_POST_DETAIL(
      new Request("http://localhost/api/posts/private-post"),
      { params: Promise.resolve({ slug: "private-post" }) }
    );

    expect(response.status).toBe(401);
    expect(mockPostFindFirst).not.toHaveBeenCalled();
  });
});
