import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockServer } from "@/tests/mocks/server";

const navigation = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => navigation.searchParams,
}));

import { HomeTimelineBoard } from "@/components/home/HomeTimelineBoard";

const initialPost = {
  id: "post-1",
  slug: "initial",
  title: "Initial post",
  content: "Initial content",
  type: "user_post",
  authorId: "user-1",
  publishedAt: "2026-08-27T00:00:00.000Z",
  author: { id: "user-1", displayName: "Alice", avatarLabel: "A" },
};

const searchPost = {
  ...initialPost,
  id: "post-2",
  slug: "matched",
  title: "Matched post",
};

const initialSnapshot = {
  boardId: "board-1",
  elements: [],
  connections: [],
};

function board() {
  return <HomeTimelineBoard posts={[initialPost]} currentUserId="user-1" initialSnapshot={initialSnapshot} />;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("HomeTimelineBoard search", () => {
  beforeEach(() => {
    navigation.searchParams = new URLSearchParams();
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    // 全局替身由共享收尾在卸载之后恢复（tests/setup/component.ts），此处只回收本文件的 spy。
    vi.restoreAllMocks();
  });

  it("shows initial posts while loading and then renders the matching response", async () => {
    navigation.searchParams = new URLSearchParams("q=matched");
    mockServer.use(
      http.get("/api/posts", () => HttpResponse.json({ posts: [searchPost] }))
    );

    render(
      <HomeTimelineBoard
        posts={[initialPost]}
        currentUserId="user-1"
        initialSnapshot={initialSnapshot}
      />
    );

    expect(screen.getByText("Initial post")).toBeInTheDocument();
    expect(await screen.findByText("Matched post")).toBeInTheDocument();
    expect(screen.queryByText("Initial post")).not.toBeInTheDocument();
  });

  it("shows the search empty state after an empty response", async () => {
    navigation.searchParams = new URLSearchParams("q=missing");
    mockServer.use(
      http.get("/api/posts", () => HttpResponse.json({ posts: [] }))
    );

    render(
      <HomeTimelineBoard
        posts={[initialPost]}
        currentUserId="user-1"
        initialSnapshot={initialSnapshot}
      />
    );

    expect(
      await screen.findByText("No posts match your search.")
    ).toBeInTheDocument();
  });

  it.each([401, 500, "network"] as const)("搜索 %s 失败时显示可访问错误并保留最近成功的结果，键盘重试可恢复", async (failure) => {
    const requests: string[] = [];
    let recovered = false;
    mockServer.use(http.get("/api/posts", ({ request }) => {
      const query = new URL(request.url).searchParams.get("q")!;
      requests.push(query);
      if (query === "matched" || recovered) return HttpResponse.json({ posts: [searchPost] });
      return failure === "network"
        ? HttpResponse.error()
        : HttpResponse.json({ error: "内部诊断不应显示" }, { status: failure });
    }));
    navigation.searchParams = new URLSearchParams("q=matched");
    const { rerender } = render(board());
    expect(await screen.findByRole("heading", { name: "Matched post" })).toBeInTheDocument();

    navigation.searchParams = new URLSearchParams("q=next");
    rerender(board());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(failure === 401 ? "登录已失效" : "搜索失败");
    expect(alert).not.toHaveTextContent("内部诊断");
    expect(screen.getByRole("heading", { name: "Matched post" })).toBeInTheDocument();
    expect(screen.queryByText("Initial post")).not.toBeInTheDocument();
    expect(screen.queryByText("No posts match your search.")).not.toBeInTheDocument();

    recovered = true;
    screen.getByRole("button", { name: "重试搜索" }).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    await waitFor(() => expect(requests).toEqual(["matched", "next", "next"]));
    expect(screen.getByRole("heading", { name: "Matched post" })).toBeInTheDocument();

    navigation.searchParams = new URLSearchParams();
    rerender(board());
    expect(screen.getByRole("heading", { name: "Initial post" })).toBeInTheDocument();
    expect(screen.queryByText("Matched post")).not.toBeInTheDocument();
  });

  it.each([401, 500, "network", "invalid-json", "missing-posts", "null-posts"] as const)(
    "首次搜索 %s 失败时保留首页，不把无效响应当作空集合",
    async (failure) => {
      navigation.searchParams = new URLSearchParams("q=first");
      mockServer.use(http.get("/api/posts", () => {
        if (failure === "network") return HttpResponse.error();
        if (failure === "invalid-json") return new HttpResponse("invalid json");
        if (failure === "missing-posts") return HttpResponse.json({});
        if (failure === "null-posts") return HttpResponse.json({ posts: null });
        return HttpResponse.json({ error: "failed" }, { status: failure });
      }));
      render(board());
      expect(await screen.findByRole("alert")).toHaveTextContent(/搜索|登录/);
      expect(screen.getByRole("heading", { name: "Initial post" })).toBeInTheDocument();
      expect(screen.queryByText("No posts match your search.")).not.toBeInTheDocument();
    },
  );

  it("上次成功为空集合时，下一次失败只显示错误而不沿用无匹配提示", async () => {
    mockServer.use(http.get("/api/posts", ({ request }) => (
      new URL(request.url).searchParams.get("q") === "empty"
        ? HttpResponse.json({ posts: [] })
        : HttpResponse.json({ error: "failed" }, { status: 500 })
    )));
    navigation.searchParams = new URLSearchParams("q=empty");
    const { rerender } = render(board());
    expect(await screen.findByText("No posts match your search.")).toBeInTheDocument();
    navigation.searchParams = new URLSearchParams("q=failed");
    rerender(board());
    expect(await screen.findByRole("alert")).toHaveTextContent("搜索失败");
    expect(screen.queryByText("No posts match your search.")).not.toBeInTheDocument();
    expect(screen.queryByText("No moments yet.")).not.toBeInTheDocument();
  });

  it.each(["success", "failure"] as const)("切换查询后，无法取消的旧 %s 响应也不能覆盖新结果", async (outcome) => {
    const oldResponse = deferred<Response>();
    const oldStarted = deferred<void>();
    const oldFinished = deferred<void>();
    // 模拟响应已进入传输层、取消无法阻止交付；HTTP 内容仍由 MSW 提供。
    const fetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const response = await fetch(input, { ...init, signal: undefined });
      if (String(input).includes("q=old")) oldFinished.resolve();
      return response;
    });
    mockServer.use(http.get("/api/posts", async ({ request }) => {
      if (new URL(request.url).searchParams.get("q") === "old") {
        oldStarted.resolve();
        return oldResponse.promise;
      }
      return HttpResponse.json({ posts: [searchPost] });
    }));
    navigation.searchParams = new URLSearchParams("q=old");
    const { rerender } = render(board());
    await oldStarted.promise;
    navigation.searchParams = new URLSearchParams("q=new");
    rerender(board());
    expect(await screen.findByRole("heading", { name: "Matched post" })).toBeInTheDocument();
    await act(async () => {
      oldResponse.resolve(outcome === "success"
        ? HttpResponse.json({ posts: [initialPost] })
        : HttpResponse.json({ error: "old failure" }, { status: 500 }));
      await oldFinished.promise;
    });
    expect(screen.getByRole("heading", { name: "Matched post" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Initial post")).not.toBeInTheDocument();
  });

  it("清空查询和卸载均取消在途请求，取消不显示错误", async () => {
    const signals: AbortSignal[] = [];
    const response = deferred<Response>();
    mockServer.use(http.get("/api/posts", ({ request }) => {
      signals.push(request.signal);
      return response.promise;
    }));
    navigation.searchParams = new URLSearchParams("q=pending");
    const { rerender, unmount } = render(board());
    await waitFor(() => expect(signals).toHaveLength(1));
    navigation.searchParams = new URLSearchParams();
    rerender(board());
    expect(signals[0].aborted).toBe(true);
    expect(screen.getByRole("heading", { name: "Initial post" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    navigation.searchParams = new URLSearchParams("q=pending-again");
    rerender(board());
    await waitFor(() => expect(signals).toHaveLength(2));
    unmount();
    expect(signals[1].aborted).toBe(true);
    response.resolve(HttpResponse.json({ posts: [] }));
  });
});
