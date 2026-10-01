import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPostFindUnique, mockPostCreate, mockPostUpdate, mockPostDelete } = vi.hoisted(() => ({
  mockPostFindUnique: vi.fn(),
  mockPostCreate: vi.fn(),
  mockPostUpdate: vi.fn(),
  mockPostDelete: vi.fn(),
}));

const { mockRequireCurrentUser, mockGetCurrentUser } = vi.hoisted(() => ({
  mockRequireCurrentUser: vi.fn(),
  mockGetCurrentUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const client = {

    post: {
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
  getCurrentUser: mockGetCurrentUser,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { POST as createPostRoute } from "@/app/api/posts/route";
import { PUT as updatePostRoute } from "@/app/api/posts/[slug]/route";
import { createPost, deletePost, updatePost } from "@/app/actions/posts";

const USER = { id: "user-1" };
const OWNED_POST = {
  id: "post-1",
  slug: "alpha",
  title: "Alpha",
  content: "既有正文",
  type: "user_post",
  authorId: "user-1",
  publishedAt: new Date("2026-09-01T00:00:00Z"),
};

const TITLE_MAX = 200;
const CONTENT_MAX = 20_000;

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function issuePaths(response: Response): Promise<string[]> {
  const body = (await response.json()) as { issues?: { path: string }[] };
  return (body.issues ?? []).map((issue) => issue.path);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCurrentUser.mockResolvedValue(USER);
  mockGetCurrentUser.mockResolvedValue(USER);
  mockPostFindUnique.mockResolvedValue(OWNED_POST);
  mockPostCreate.mockResolvedValue({ ...OWNED_POST });
  mockPostUpdate.mockResolvedValue({ ...OWNED_POST });
  mockPostDelete.mockResolvedValue(OWNED_POST);
});

describe("POST /api/posts 写入契约", () => {
  it("非字符串字段返回稳定验证错误，且不调用 Prisma", async () => {
    const response = await createPostRoute(
      jsonRequest("http://localhost/api/posts", "POST", { title: { text: "Alpha" }, content: "正文" })
    );

    expect(response.status).toBe(400);
    expect(await issuePaths(response)).toEqual(["title"]);
    expect(mockPostCreate).not.toHaveBeenCalled();
  });

  it("数组字段返回稳定验证错误，且不调用 Prisma", async () => {
    const response = await createPostRoute(
      jsonRequest("http://localhost/api/posts", "POST", { title: "Alpha", content: ["正文"] })
    );

    expect(response.status).toBe(400);
    expect(await issuePaths(response)).toEqual(["content"]);
    expect(mockPostCreate).not.toHaveBeenCalled();
  });

  it("无法解析的 JSON body 返回 400 而不是 500，且不调用 Prisma", async () => {
    const response = await createPostRoute(
      jsonRequest("http://localhost/api/posts", "POST", '{"title": "Alpha", ')
    );

    expect(response.status).toBe(400);
    expect(await issuePaths(response)).toEqual(["title", "content"]);
    expect(mockPostCreate).not.toHaveBeenCalled();
  });

  it("超长标题与正文返回稳定验证错误，且不调用 Prisma", async () => {
    const response = await createPostRoute(
      jsonRequest("http://localhost/api/posts", "POST", {
        title: "a".repeat(TITLE_MAX + 1),
        content: "b".repeat(CONTENT_MAX + 1),
      })
    );

    expect(response.status).toBe(400);
    expect(await issuePaths(response)).toEqual(["title", "content"]);
    expect(mockPostCreate).not.toHaveBeenCalled();
  });

  it("接受边界长度的标题与正文", async () => {
    const response = await createPostRoute(
      jsonRequest("http://localhost/api/posts", "POST", {
        title: "a".repeat(TITLE_MAX),
        content: "b".repeat(CONTENT_MAX),
      })
    );

    expect(response.status).toBe(200);
    expect(mockPostCreate).toHaveBeenCalledTimes(1);
  });

  it("只填空格的标题视为缺失，且不调用 Prisma", async () => {
    const response = await createPostRoute(
      jsonRequest("http://localhost/api/posts", "POST", { title: "   ", content: "正文" })
    );

    expect(response.status).toBe(400);
    expect(await issuePaths(response)).toEqual(["title"]);
    expect(mockPostCreate).not.toHaveBeenCalled();
  });

  it("只接受 title/content，其他字段不能改变写入内容", async () => {
    await createPostRoute(
      jsonRequest("http://localhost/api/posts", "POST", {
        title: "  中文标题  ",
        content: "  # 标题\n\n正文  ",
        type: "agent_log",
        authorId: "someone-else",
        roomId: "room-x",
      })
    );

    expect(mockPostCreate).toHaveBeenCalledTimes(1);
    expect(mockPostCreate.mock.calls[0][0]).toMatchObject({
      data: { title: "中文标题", content: "# 标题\n\n正文", type: "user_post", authorId: "user-1" },
    });
  });
});

describe("PUT /api/posts/[slug] 写入契约", () => {
  function put(slug: string, body: unknown) {
    return updatePostRoute(jsonRequest(`http://localhost/api/posts/${slug}`, "PUT", body), {
      params: Promise.resolve({ slug }),
    });
  }

  it("空 patch 返回稳定验证错误，且不更新", async () => {
    const response = await put("alpha", {});

    expect(response.status).toBe(400);
    expect(await issuePaths(response)).toEqual([""]);
    expect(mockPostUpdate).not.toHaveBeenCalled();
  });

  it("只填空格的字段等同于空 patch，且不更新", async () => {
    const response = await put("alpha", { title: "  ", content: "   " });

    expect(response.status).toBe(400);
    expect(mockPostUpdate).not.toHaveBeenCalled();
  });

  it("非字符串标题返回稳定验证错误，且不更新", async () => {
    const response = await put("alpha", { title: 42 });

    expect(response.status).toBe(400);
    expect(await issuePaths(response)).toEqual(["title"]);
    expect(mockPostUpdate).not.toHaveBeenCalled();
  });

  it("超长正文返回稳定验证错误，且不更新", async () => {
    const response = await put("alpha", { content: "b".repeat(CONTENT_MAX + 1) });

    expect(response.status).toBe(400);
    expect(await issuePaths(response)).toEqual(["content"]);
    expect(mockPostUpdate).not.toHaveBeenCalled();
  });

  it("只提供正文时更新正文并保持原 slug（不重新分配）", async () => {
    const response = await put("alpha", { content: "  ## 新正文  " });

    expect(response.status).toBe(200);
    expect(mockPostUpdate).toHaveBeenCalledTimes(1);
    expect(mockPostUpdate.mock.calls[0][0]).toMatchObject({ data: { content: "## 新正文" } });
    expect(mockPostUpdate.mock.calls[0][0].data).not.toHaveProperty("slug");
  });
});

describe("Post Server Action 写入契约", () => {
  it("非字符串标题返回稳定错误而不是原始异常 message，且不调用 Prisma", async () => {
    const result = await createPost(42 as unknown as string, "正文");

    expect(result).toEqual({ error: "Title must be text" });
    expect(mockPostCreate).not.toHaveBeenCalled();
  });

  it("只填空格的标题返回稳定错误，且不调用 Prisma", async () => {
    const result = await createPost("   ", "正文");

    expect(result).toEqual({ error: "Title is required" });
    expect(mockPostCreate).not.toHaveBeenCalled();
  });

  it("超长正文返回稳定错误，且不调用 Prisma", async () => {
    const result = await createPost("标题", "b".repeat(CONTENT_MAX + 1));

    expect(result).toEqual({ error: `Content must be ${CONTENT_MAX} characters or fewer` });
    expect(mockPostCreate).not.toHaveBeenCalled();
  });

  it("合法中英文与 Markdown 以 trim 后的值创建", async () => {
    mockPostCreate.mockResolvedValue({ id: "post-2", slug: "xin-biao-ti", title: "中文标题", content: "# 正文" });

    const result = await createPost("  中文标题  ", "  # 正文  ");

    expect(result).toEqual({ post: { id: "post-2", slug: "xin-biao-ti", title: "中文标题" } });
    expect(mockPostCreate.mock.calls[0][0]).toMatchObject({ data: { title: "中文标题", content: "# 正文" } });
  });

  it("更新时空 patch 返回稳定错误，且不调用 Prisma", async () => {
    const result = await updatePost("alpha", "  ", "   ");

    expect(result).toEqual({ error: "Title is required" });
    expect(mockPostUpdate).not.toHaveBeenCalled();
  });

  it("非字符串 slug 返回稳定错误，且不查询数据库", async () => {
    const result = await updatePost(42 as unknown as string, "Alpha", "正文");

    expect(result).toEqual({ error: "Post slug must be text" });
    expect(mockPostFindUnique).not.toHaveBeenCalled();
    expect(mockPostUpdate).not.toHaveBeenCalled();
  });

  it("删除时非字符串 slug 返回稳定错误，且不查询数据库", async () => {
    const result = await deletePost(42 as unknown as string);

    expect(result).toEqual({ error: "Post slug must be text" });
    expect(mockPostFindUnique).not.toHaveBeenCalled();
    expect(mockPostDelete).not.toHaveBeenCalled();
  });

  it("合法更新与删除保持既有成功结果", async () => {
    await expect(updatePost("alpha", "Alpha 2", "正文 2")).resolves.toEqual({
      post: { id: "post-1", slug: "alpha", title: "Alpha" },
    });
    expect(mockPostUpdate.mock.calls[0][0]).toMatchObject({
      data: { title: "Alpha 2", content: "正文 2" },
    });

    await expect(deletePost("alpha")).resolves.toEqual({ deleted: true });
    expect(mockPostDelete).toHaveBeenCalledWith({ where: { id: "post-1" } });
  });
});
