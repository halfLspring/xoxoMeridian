import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireCurrentUser, mockGetCurrentUser, mockPostCreate } = vi.hoisted(() => ({
  mockRequireCurrentUser: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  mockPostCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const client = {

    post: {
      create: mockPostCreate,
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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

import { createPost as createPostAction } from "@/app/actions/posts";
import { POST as createPostRoute } from "@/app/api/posts/route";

// 真实 Prisma 唯一冲突的形状：message 里带 ORM 调用、约束名与不换行前缀。
// 这些内容一旦出现在响应里，就是把数据库内部结构交给客户端。
function uniqueConstraintError(): Error {
  const error = new Error(
    "\nInvalid `prisma.post.create()` invocation:\n\n\nUnique constraint failed on the constraint: `Post_title_key`"
  );
  return Object.assign(error, { code: "P2002", meta: { modelName: "Post", target: ["title"] } });
}

// 响应里不得出现的内部细节标记：ORM/调用名、约束名、SQL 关键字、stack 帧。
const INTERNAL_MARKERS = [
  "prisma",
  "PrismaClientKnownRequestError",
  "Unique constraint",
  "Post_title_key",
  "P2002",
  "INSERT",
  "SELECT",
  "at Object.",
  "\n    at ",
];

function expectNoInternalDetails(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const marker of INTERNAL_MARKERS) {
    expect(text).not.toContain(marker);
  }
}

function postRequest(body: unknown) {
  return createPostRoute(
    new Request("http://localhost/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCurrentUser.mockResolvedValue({ id: "user-1" });
  mockGetCurrentUser.mockResolvedValue({ id: "user-1", profile: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("API 通用错误响应不泄漏内部异常", () => {
  it("注入唯一约束冲突时只返回稳定的通用错误", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockPostCreate.mockRejectedValue(uniqueConstraintError());

      const response = await createPostRoute(
        new Request("http://localhost/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Alpha", content: "正文" }),
        })
      );

      expect(response.status).toBe(500);
      const payload = await response.json();
      expect(payload).toEqual({ error: "Internal server error" });
      expectNoInternalDetails(payload);
    } finally {
      log.mockRestore();
    }
  });

  it("注入数据库异常时响应既不含原始 message 也不含 stack", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockPostCreate.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));

      const response = await createPostRoute(
        new Request("http://localhost/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Beta", content: "正文" }),
        })
      );

      expect(response.status).toBe(500);
      const payload = (await response.json()) as Record<string, unknown>;
      expect(payload).toEqual({ error: "Internal server error" });
      expect(JSON.stringify(payload)).not.toContain("ECONNREFUSED");
      expect(JSON.stringify(payload)).not.toContain("127.0.0.1");
      expect(payload).not.toHaveProperty("details");
    } finally {
      log.mockRestore();
    }
  });

  it("畸形 JSON 仍是稳定的验证错误契约，而不是 500", async () => {
    // 防回归守卫：畸形 JSON 在旧实现下同样返回 400，本用例固定该契约不被通用错误改动带走。
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await postRequest("{ not json");

      expect(response.status).toBe(400);
      const payload = (await response.json()) as { error: string; issues: unknown[] };
      expect(payload.error).toBe("Invalid request");
      expect(Array.isArray(payload.issues)).toBe(true);
      expectNoInternalDetails(payload);
      expect(mockPostCreate).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("请求体中的用户内容不会进入错误日志", async () => {
    const logged: string[] = [];
    const log = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map((value) => String(value)).join(" "));
    });
    try {
      mockPostCreate.mockRejectedValue(uniqueConstraintError());

      await createPostRoute(
        new Request("http://localhost/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "SECRET-TITLE-9f2c",
            content: "SECRET-BODY-9f2c",
          }),
        })
      );

      const output = logged.join("\n");
      expect(output).toContain("[api]");
      expect(output).toContain("Unique constraint failed on the constraint: `Post_title_key`");
      expect(output).not.toContain("SECRET-TITLE-9f2c");
      expect(output).not.toContain("SECRET-BODY-9f2c");
    } finally {
      log.mockRestore();
    }
  });
});

describe("Server Action 通用错误返回值不泄漏内部异常", () => {
  it("注入唯一约束冲突时只返回稳定的通用文案", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockPostCreate.mockRejectedValue(uniqueConstraintError());

      const result = await createPostAction("Gamma", "正文");

      expect(result).toEqual({ error: "Internal server error" });
      expectNoInternalDetails(result);
    } finally {
      log.mockRestore();
    }
  });

  it("注入数据库异常时返回值既不含原始 message 也不含 stack", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockPostCreate.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));

      const result = await createPostAction("Delta", "正文");

      expect(result).toEqual({ error: "Internal server error" });
      expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
    } finally {
      log.mockRestore();
    }
  });

  it("验证失败的字段文案保持原样，不被通用文案取代", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(createPostAction("   ", "正文")).resolves.toEqual({
        error: "Title is required",
      });
      expect(mockPostCreate).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("日志保留 Action 上下文前缀与内部原因，且不含用户内容", async () => {
    const logged: string[] = [];
    const log = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map((value) => String(value)).join(" "));
    });
    try {
      mockPostCreate.mockRejectedValue(uniqueConstraintError());

      await createPostAction("SECRET-TITLE-9f2c", "SECRET-BODY-9f2c");

      const output = logged.join("\n");
      expect(output).toContain("[createPost]");
      expect(output).toContain("Unique constraint failed on the constraint: `Post_title_key`");
      expect(output).not.toContain("SECRET-TITLE-9f2c");
      expect(output).not.toContain("SECRET-BODY-9f2c");
    } finally {
      log.mockRestore();
    }
  });
});

describe("生产与开发的错误响应契约一致", () => {
  it("同一注入错误在 development 与 production 得到完全相同的响应", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // observed[0] 是 development、observed[1] 是 production：各自在对应 NODE_ENV 下
      // 重新加载模块，让 env 解析走到该环境的分支。
      const observed: Array<{ status: number; body: unknown }> = [];

      for (const nodeEnv of ["development", "production"]) {
        vi.stubEnv("NODE_ENV", nodeEnv);
        vi.resetModules();
        const { errorToResponse } = await import("@/lib/api");
        const response = errorToResponse(uniqueConstraintError());
        observed.push({ status: response.status, body: await response.json() });
      }

      vi.unstubAllEnvs();
      vi.resetModules();

      expect(observed[0].status).toBe(500);
      expect(observed[0]).toEqual(observed[1]);
      expect(observed[0].body).toEqual({ error: "Internal server error" });
      expectNoInternalDetails(observed[0].body);
    } finally {
      log.mockRestore();
    }
  });
});
