import { StrictMode, type ReactNode } from "react";
import { act, render as renderView, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlogWorkspace } from "@/components/blog-work/BlogWorkspace";
import { BlogActionProvider, useBlogActions } from "@/components/blog-work/BlogActionProvider";
import type { WorkSnapshot } from "@/lib/blog-work/types";
import { mockServer } from "@/tests/mocks/server";

const navigation = vi.hoisted(() => ({ query: "", refresh: vi.fn() }));
vi.mock("next/navigation", async () => {
  const { useMemo } = await import("react");
  return {
    useRouter: () => ({ refresh: navigation.refresh }),
    useSearchParams: () => {
      const query = navigation.query;
      return useMemo(() => new URLSearchParams(query), [query]);
    },
  };
});

const work: WorkSnapshot = {
  id: "work-first", ownerId: "author", ownerName: "作者", status: "draft", revision: 0,
  viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540, layoutWidth: 960,
  draftX: 24, draftY: 40, publishedAt: null, updatedAt: "2026-09-30T00:00:00Z",
  canManage: true, posts: [], elements: [], connections: [],
};
const showModalDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");

function ActionButtons() {
  const actions = useBlogActions()!;
  return <><button onClick={() => actions.requestAction("list")}>入口：My Draft</button><button onClick={() => actions.requestAction("new")}>入口：新增草稿</button></>;
}
function render(ui: ReactNode) {
  return renderView(ui, { wrapper: ({ children }) => <BlogActionProvider><ActionButtons />{children}</BlogActionProvider> });
}

function holdResponse() {
  let release!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { release = resolve; });
  const originalFetch = globalThis.fetch, bodies: Array<Promise<ArrayBuffer>> = [];
  const fetches = vi.spyOn(globalThis, "fetch").mockImplementation(async (...args) => {
    const received = await originalFetch(...args);
    bodies.push(received.clone().arrayBuffer());
    return received;
  });
  return {
    response,
    async deliver(reply = HttpResponse.json({ work })) {
      // 等真实 MSW 响应及正文读完，再断言旧响应没有引起界面或回调变化。
      await act(async () => {
        release(reply);
        await Promise.all(fetches.mock.results.map(result => result.value));
        await Promise.all(bodies);
      });
    },
  };
}

beforeEach(() => {
  navigation.query = "";
  navigation.refresh.mockClear();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.open = true; },
  });
  mockServer.use(http.get("/api/blog/works", () => HttpResponse.json({
    drafts: [{ id: work.id, title: "第一份草稿", updatedAt: work.updatedAt, thumbnail: null, revision: 0 }],
    nextCursor: null,
  })));
});
afterEach(() => {
  vi.restoreAllMocks();
  if (showModalDescriptor) Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModalDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

describe("草稿入口请求生命周期", () => {
  it.each(["draft", "work"])("Strict Mode 首次进入 %s 深链能够打开，普通重渲染不会重新加载", async kind => {
    navigation.query = `${kind}=${work.id}`;
    const read = vi.fn(() => HttpResponse.json({ work }));
    mockServer.use(http.get(`/api/blog/works/${work.id}`, read));
    const view = render(<StrictMode><BlogWorkspace actorId="author" /></StrictMode>);
    expect(await screen.findByRole("region", { name: "空间草稿" })).toHaveAttribute("data-work-id", work.id);
    expect(screen.queryByText("正在打开作品…")).toBeNull();
    const requestsAfterOpen = read.mock.calls.length;
    navigation.query += "&unrelated=changed";
    view.rerender(<StrictMode><BlogWorkspace actorId="author" /></StrictMode>);
    expect(read).toHaveBeenCalledTimes(requestsAfterOpen);
    await userEvent.click(screen.getByRole("button", { name: "退出草稿" }));
    view.rerender(<StrictMode><BlogWorkspace actorId="author" /></StrictMode>);
    expect(screen.queryByRole("region", { name: "空间草稿" })).toBeNull();
    expect(read).toHaveBeenCalledTimes(requestsAfterOpen);
  });

  it("移除仍在加载的深链立即结束打开状态，迟到成功响应无效", async () => {
    navigation.query = `draft=${work.id}`;
    const held = holdResponse(), read = vi.fn(() => held.response);
    mockServer.use(http.get(`/api/blog/works/${work.id}`, read));
    const view = render(<BlogWorkspace actorId="author" />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(screen.getByText("正在打开作品…")).toBeInTheDocument();
    navigation.query = "";
    view.rerender(<BlogWorkspace actorId="author" />);
    expect(screen.queryByText("正在打开作品…")).toBeNull();
    await held.deliver();
    expect(screen.queryByRole("region", { name: "空间草稿" })).toBeNull();
  });

  it.each([200, 500])("切换并退出另一份草稿后，旧的 %s 响应不能重开作品或显示错误", async status => {
    navigation.query = `draft=${work.id}`;
    const held = holdResponse(), read = vi.fn(() => held.response);
    mockServer.use(
      http.get(`/api/blog/works/${work.id}`, read),
      http.get("/api/blog/works/work-second", () => HttpResponse.json({ work: { ...work, id: "work-second" } })),
    );
    const view = render(<BlogWorkspace actorId="author" />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    navigation.query = "draft=work-second";
    view.rerender(<BlogWorkspace actorId="author" />);
    expect(await screen.findByRole("region", { name: "空间草稿" })).toHaveAttribute("data-work-id", "work-second");
    await userEvent.click(screen.getByRole("button", { name: "退出草稿" }));
    await held.deliver(HttpResponse.json({ work }, { status }));
    expect(screen.queryByRole("region", { name: "空间草稿" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("正在打开作品…")).toBeNull();
  });

  it("关闭草稿列表取消已选作品的读取，迟到响应不能重开", async () => {
    const held = holdResponse(), read = vi.fn(() => held.response);
    mockServer.use(http.get(`/api/blog/works/${work.id}`, read));
    render(<BlogWorkspace actorId="author" />);
    await userEvent.click(screen.getByRole("button", { name: "入口：My Draft" }));
    await userEvent.click(await screen.findByRole("button", { name: /^第一份草稿/ }));
    await waitFor(() => expect(read).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "关闭My Draft" }));
    await held.deliver();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("region", { name: "空间草稿" })).toBeNull();
    expect(screen.queryByText("正在打开作品…")).toBeNull();
  });

  it("加载中切到框选后，旧响应不能替换新流程，取消框选结束等待", async () => {
    navigation.query = `draft=${work.id}`;
    const held = holdResponse(), read = vi.fn(() => held.response);
    mockServer.use(http.get(`/api/blog/works/${work.id}`, read));
    render(<BlogWorkspace actorId="author" />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "入口：新增草稿" }));
    expect(screen.getByRole("button", { name: "使用默认区域" })).toBeEnabled();
    await held.deliver();
    expect(screen.getByRole("group", { name: "框选草稿区域" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "空间草稿" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "取消框选" }));
    expect(screen.queryByRole("group", { name: "框选草稿区域" })).toBeNull();
  });

  it("同一深链换账号必须重新鉴权，前一账号迟到的私密响应无效", async () => {
    navigation.query = `draft=${work.id}`;
    const held = holdResponse(), viewers: Array<string | null> = [];
    mockServer.use(http.get(`/api/blog/works/${work.id}`, ({ request }) => {
      const viewer = request.headers.get("X-Blog-Viewer-Id");
      viewers.push(viewer);
      return viewer === "author" ? held.response : HttpResponse.json({ error: "不可用" }, { status: 404 });
    }));
    const changed = vi.fn(), view = render(<BlogWorkspace actorId="author" onDraftChange={changed} />);
    await waitFor(() => expect(viewers).toEqual(["author"]));
    view.rerender(<BlogWorkspace actorId="other" onDraftChange={changed} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("作品不可用");
    expect(viewers).toEqual(["author", "other"]);
    await held.deliver();
    expect(screen.queryByRole("region", { name: "空间草稿" })).toBeNull();
    expect(changed.mock.calls.every(([value]) => value === null)).toBe(true);
  });

  it("等待保存期间取消切换，保存完成后留在原稿且仍能继续编辑", async () => {
    navigation.query = `draft=${work.id}`;
    const held = holdResponse(), write = vi.fn(() => held.response), readSecond = vi.fn(() => HttpResponse.json({ work: { ...work, id: "work-second" } }));
    mockServer.use(
      http.get(`/api/blog/works/${work.id}`, () => HttpResponse.json({ work })),
      http.patch(`/api/blog/works/${work.id}`, write),
      http.get("/api/blog/works/work-second", readSecond),
    );
    const view = render(<BlogWorkspace actorId="author" />);
    await userEvent.click(await screen.findByRole("button", { name: "博文" }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    navigation.query = "draft=work-second";
    view.rerender(<BlogWorkspace actorId="author" />);
    expect(screen.getByText("正在等待保存后离开。")).toBeInTheDocument();
    navigation.query = "";
    view.rerender(<BlogWorkspace actorId="author" />);
    await held.deliver(HttpResponse.json({ work: { ...work, revision: 1 } }));
    expect(readSecond).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "空间草稿" })).toHaveAttribute("data-work-id", work.id);
    expect(screen.getByRole("button", { name: "博文" })).toBeEnabled();
    expect(screen.getByText("已自动保存", { exact: true })).toBeInTheDocument();
  });

  it("创建中按 Escape 退出框选，迟到创建响应不能打开已经取消的草稿", async () => {
    const held = holdResponse(), create = vi.fn(() => held.response);
    mockServer.use(http.post("/api/blog/works", create));
    render(<BlogWorkspace actorId="author" />);
    await userEvent.click(screen.getByRole("button", { name: "入口：新增草稿" }));
    await userEvent.click(screen.getByRole("button", { name: "使用默认区域" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    await userEvent.keyboard("{Escape}");
    await held.deliver();
    expect(screen.queryByRole("region", { name: "空间草稿" })).toBeNull();
    expect(screen.queryByRole("group", { name: "框选草稿区域" })).toBeNull();
    expect(screen.queryByText("正在打开作品…")).toBeNull();
  });

  it("账号变化立即清掉已打开的私密作品", async () => {
    navigation.query = `draft=${work.id}`;
    mockServer.use(http.get(`/api/blog/works/${work.id}`, ({ request }) => request.headers.get("X-Blog-Viewer-Id") === "author"
      ? HttpResponse.json({ work }) : HttpResponse.json({ error: "不可用" }, { status: 404 })));
    const view = render(<BlogWorkspace actorId="author" />);
    await screen.findByRole("region", { name: "空间草稿" });
    view.rerender(<BlogWorkspace actorId="other" />);
    expect(screen.queryByRole("region", { name: "空间草稿" })).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent("作品不可用");
  });

  it("卸载后迟到响应不会再向外发布草稿状态", async () => {
    navigation.query = `draft=${work.id}`;
    const held = holdResponse(), read = vi.fn(() => held.response);
    mockServer.use(http.get(`/api/blog/works/${work.id}`, read));
    const changed = vi.fn(), view = render(<BlogWorkspace actorId="author" onDraftChange={changed} />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    view.unmount();
    changed.mockClear();
    await held.deliver();
    expect(changed).not.toHaveBeenCalled();
  });
});
