import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlogActionProvider, useBlogActions } from "@/components/blog-work/BlogActionProvider";
import { BlogWorkspace } from "@/components/blog-work/BlogWorkspace";
import { SiteNav } from "@/components/blog/SiteNav";
import { HomeContextMenu } from "@/components/home/HomeContextMenu";
import type { WorkSnapshot } from "@/lib/blog-work/types";
import { mockServer } from "@/tests/mocks/server";

const navigation = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

const work: WorkSnapshot = {
  id: "work-first", ownerId: "author", ownerName: "作者", status: "draft", revision: 0,
  viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540, layoutWidth: 960,
  draftX: 24, draftY: 40, publishedAt: null, updatedAt: "2026-09-30T00:00:00Z",
  canManage: true, posts: [], elements: [], connections: [],
};
const showModalDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
beforeEach(() => {
  navigation.query = "";
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.open = true; },
  });
  mockServer.use(
    http.get("/api/blog/works", () => HttpResponse.json({ drafts: [], nextCursor: null })),
    http.get(`/api/blog/works/${work.id}`, () => HttpResponse.json({ work })),
  );
});
afterEach(() => {
  if (showModalDescriptor) Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModalDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

function DelayedAction({ wait }: { wait: Promise<void> }) {
  const actions = useBlogActions()!;
  return <button onClick={async () => { await wait; actions.requestAction("new"); }}>延迟进入框选</button>;
}

function Page({ ready, actorId = "author", menu = false, delayed }: { ready: boolean; actorId?: string; menu?: boolean; delayed?: Promise<void> }) {
  return <StrictMode><BlogActionProvider key={actorId}>
    <SiteNav displayName="作者" />
    {menu && <HomeContextMenu state={{ screenX: 0, screenY: 0, boardX: 0, boardY: 0 }} onAddPhoto={() => {}} />}
    {delayed && <DelayedAction wait={delayed} />}
    {ready && <BlogWorkspace actorId={actorId} />}
  </BlogActionProvider></StrictMode>;
}

describe("草稿入口在工作区就绪前的动作", () => {
  it("My Draft 首次点击早于工作区挂载时仍打开，消费后关闭不会再次重放", async () => {
    const view = render(<Page ready={false} />);
    let prevented = false;
    document.addEventListener("click", event => { prevented = event.defaultPrevented; }, { once: true });
    await userEvent.click(screen.getByRole("link", { name: "My Draft" }));
    expect(prevented).toBe(true);
    expect(screen.queryByRole("dialog", { name: "My Draft" })).toBeNull();
    // 等价于导航已水合、Suspense 中的工作区稍后才水合的可控时序。
    view.rerender(<Page ready />);
    expect(await screen.findByRole("dialog", { name: "My Draft" })).toHaveTextContent("右键选择“新增草稿”");
    await userEvent.click(screen.getByRole("button", { name: "关闭My Draft" }));
    view.rerender(<Page ready />);
    expect(screen.queryByRole("dialog", { name: "My Draft" })).toBeNull();
    await userEvent.click(screen.getByRole("link", { name: "My Draft" }));
    expect(await screen.findByRole("dialog", { name: "My Draft" })).toBeInTheDocument();
  });

  it("右键新增草稿早于工作区挂载也能恢复，取消后不会重放", async () => {
    const view = render(<Page ready={false} menu />);
    await userEvent.click(screen.getByRole("button", { name: "新增草稿" }));
    view.rerender(<Page ready menu />);
    expect(await screen.findByRole("group", { name: "框选草稿区域" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    view.rerender(<Page ready menu />);
    expect(screen.queryByRole("group", { name: "框选草稿区域" })).toBeNull();
  });

  it("就绪前最后一次选择优先于旧选择和已有作品深链", async () => {
    navigation.query = `draft=${work.id}`;
    const view = render(<Page ready={false} menu />);
    await userEvent.click(screen.getByRole("link", { name: "My Draft" }));
    await userEvent.click(screen.getByRole("button", { name: "新增草稿" }));
    view.rerender(<Page ready menu />);
    expect(await screen.findByRole("group", { name: "框选草稿区域" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "My Draft" })).toBeNull();
    expect(screen.queryByRole("region", { name: "空间草稿" })).toBeNull();
  });

  it.each(["author", "other"])("页面卸载后的未消费动作及迟到回调不影响新页面 %s", async actorId => {
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const view = render(<Page ready={false} delayed={delayed} />);
    await userEvent.click(screen.getByRole("link", { name: "My Draft" }));
    await userEvent.click(screen.getByRole("button", { name: "延迟进入框选" }));
    view.unmount();
    render(<Page ready actorId={actorId} />);
    await act(async () => { release(); await delayed; });
    expect(screen.queryByRole("dialog", { name: "My Draft" })).toBeNull();
    expect(screen.queryByRole("group", { name: "框选草稿区域" })).toBeNull();
    await userEvent.click(screen.getByRole("link", { name: "My Draft" }));
    expect(await screen.findByRole("dialog", { name: "My Draft" })).toBeInTheDocument();
  });

  it("账号切换丢弃尚未消费的入口动作", async () => {
    const view = render(<Page ready={false} />);
    await userEvent.click(screen.getByRole("link", { name: "My Draft" }));
    view.rerender(<Page ready actorId="other" />);
    expect(screen.queryByRole("dialog", { name: "My Draft" })).toBeNull();
  });

  it("新增入口等待未保存修改落库后才进入框选，深链读取仍可用", async () => {
    navigation.query = `draft=${work.id}`;
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const write = vi.fn(async () => { await delayed; return HttpResponse.json({ work: { ...work, revision: 1 } }); });
    mockServer.use(http.patch(`/api/blog/works/${work.id}`, write));
    render(<Page ready menu />);
    await userEvent.click(await screen.findByRole("button", { name: "博文" }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "新增草稿" }));
    expect(screen.getByText("正在等待保存后离开。")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "框选草稿区域" })).toBeNull();
    await act(async () => { release(); });
    expect(await screen.findByRole("group", { name: "框选草稿区域" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "空间草稿" })).toBeNull();
  });

  it("draft=list 深链仍直接打开列表", async () => {
    navigation.query = "draft=list";
    render(<Page ready />);
    expect(await screen.findByRole("dialog", { name: "My Draft" })).toBeInTheDocument();
  });

  it("工作区卸载时丢弃等待保存的入口，重新挂载不会重放", async () => {
    navigation.query = `draft=${work.id}`;
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    mockServer.use(http.patch(`/api/blog/works/${work.id}`, async () => {
      await delayed;
      return HttpResponse.json({ work: { ...work, revision: 1 } });
    }));
    const view = render(<Page ready menu />);
    await userEvent.click(await screen.findByRole("button", { name: "博文" }));
    await userEvent.click(screen.getByRole("button", { name: "新增草稿" }));
    expect(screen.getByText("正在等待保存后离开。")).toBeInTheDocument();
    view.rerender(<Page ready={false} menu />);
    await act(async () => { release(); });
    view.rerender(<Page ready menu />);
    expect(await screen.findByRole("region", { name: "空间草稿" })).toHaveAttribute("data-work-id", work.id);
    expect(screen.queryByRole("group", { name: "框选草稿区域" })).toBeNull();
  });
});
