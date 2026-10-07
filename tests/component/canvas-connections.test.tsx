import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkEditor } from "@/components/blog-work/WorkEditor";
import { HomeTimelineBoard } from "@/components/home/HomeTimelineBoard";
import type { WorkSnapshot } from "@/lib/blog-work/types";
import type { MutationInput, WorkCommand } from "@/lib/blog-work/schemas";
import { mockServer } from "@/tests/mocks/server";

const navigation = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => navigation.params }));
const initial: WorkSnapshot = {
  id: "draft", ownerId: "author", ownerName: "作者", status: "draft", revision: 0,
  viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540, layoutWidth: 960,
  publishedAt: null, updatedAt: "2026-10-07T00:00:00Z", canManage: true,
  posts: [{ id: "post", elementId: "note", title: "草稿正文", content: "点击正文连线", workOrder: 0, slug: null, publishedAt: null }],
  elements: ["photo", "other-photo", "note"].map((id, index) => ({ id, workId: "draft", postId: id === "note" ? "post" : null,
    type: id === "note" ? "note" : "photo", x: 400 + index * 150, y: 100, width: 120, height: 90, rotation: 0, zIndex: 1,
    imageUrl: id === "note" ? null : "/photo.png", caption: id, content: null, createdById: "author", createdAt: "2026-10-07T00:00:00Z" })),
  connections: [],
};
type Body = MutationInput & { command: WorkCommand };
const editor = (work = initial) => <WorkEditor key={work.id} initial={work} actorId="author" onClose={vi.fn()} onPublished={vi.fn()} onDeleted={vi.fn()} />;
const endpoint = (name: string) => screen.getByRole("button", { name });
const select = (name: string) => fireEvent.click(endpoint(name));

const showModalDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
beforeEach(() => {
  navigation.params = new URLSearchParams();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  for (const name of ["ResizeObserver", "IntersectionObserver"]) vi.stubGlobal(name, class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(180);
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  if (showModalDescriptor) Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModalDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

function store(work = initial, fail?: "create" | "delete") {
  let saved = structuredClone(work), failed = false;
  const requests: Body[] = [];
  mockServer.use(
    http.get(`/api/blog/works/${work.id}`, () => HttpResponse.json({ work: saved })),
    http.patch(`/api/blog/works/${work.id}`, async ({ request }) => {
      const input = await request.json() as Body; requests.push(input);
      const command = input.command;
      if (!failed && command.operation === `connection.${fail}`) { failed = true; return HttpResponse.json({ error: "未确认保存" }, { status: 500 }); }
      if (command.operation === "connection.create") saved.connections.push({ id: "line", workId: work.id, ...command.data, color: "#72975a" });
      if (command.operation === "connection.delete") saved.connections = saved.connections.filter(line => line.id !== command.id);
      saved.revision++;
      return HttpResponse.json({ work: saved });
    }),
  );
  return requests;
}

describe("草稿与画板共用点击接线", () => {
  it("相同端点、Escape、1500ms 超时和切换作品均清除选择，正文与 Edit 不接线", async () => {
    vi.useFakeTimers();
    const view = render(editor());
    expect(within(screen.getByRole("toolbar")).getAllByRole("button").map(button => button.textContent)).toEqual(["博文", "图片"]);
    select("连接照片：photo"); expect(endpoint("连接照片：photo")).toHaveAttribute("aria-pressed", "true");
    select("连接照片：photo"); expect(endpoint("连接照片：photo")).toHaveAttribute("aria-pressed", "false");
    select("连接照片：photo"); fireEvent.keyDown(window, { key: "Escape" });
    expect(endpoint("连接照片：photo")).toHaveAttribute("aria-pressed", "false");
    select("连接照片：photo"); act(() => vi.advanceTimersByTime(1499));
    expect(endpoint("连接照片：photo")).toHaveAttribute("aria-pressed", "true");
    act(() => vi.advanceTimersByTime(1));
    expect(endpoint("连接照片：photo")).toHaveAttribute("aria-pressed", "false");
    select("连接照片：photo");
    fireEvent.click(screen.getByRole("button", { name: "草稿正文" }));
    expect(screen.getByRole("dialog", { name: "编辑博文" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "关闭编辑博文" }));
    expect(endpoint("连接照片：photo")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByText("点击正文连线"));
    expect(endpoint("连接博文：草稿正文")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog", { name: "编辑博文" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "关闭编辑博文" }));
    select("连接照片：photo");
    view.rerender(editor({ ...initial, id: "another", elements: initial.elements.map(e => ({ ...e, workId: "another" })) }));
    expect(endpoint("连接照片：photo")).toHaveAttribute("aria-pressed", "false");
    view.unmount();
    act(() => vi.advanceTimersByTime(1500));
  });

  it.each(["create", "delete"] as const)("键盘接线与删除在 %s 失败后保留真实状态，重试沿用幂等标识", async operation => {
    const requests = store(initial, operation), user = userEvent.setup();
    render(editor());
    endpoint("连接照片：photo").focus(); await user.keyboard("{Enter}");
    endpoint("连接博文：草稿正文").focus(); await user.keyboard(" ");
    if (operation === "delete") {
      const deletion = await screen.findByRole("button", { name: "删除作品连线 1" });
      await waitFor(() => expect(deletion).toHaveAttribute("aria-disabled", "false"));
      deletion.focus(); await user.keyboard("{Enter}");
    }
    await screen.findByText("保存失败", { exact: true });
    expect(screen.queryByText("已自动保存", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "删除作品连线 1" })).toHaveLength(operation === "delete" ? 1 : 0);
    await user.click(screen.getByRole("button", { name: "重试保存" }));
    await screen.findByText("已自动保存", { exact: true });
    expect(screen.queryAllByRole("button", { name: "删除作品连线 1" })).toHaveLength(operation === "delete" ? 0 : 1);
    expect(requests.at(-1)).toEqual(requests.at(-2));
    expect(requests[0]).toMatchObject({ expectedStatus: "draft", command: { operation: "connection.create", data: { fromId: "photo", toId: "note" } } });
  });

  it("作品后台回读保留有效端点选择，仍能接续第二个端点", async () => {
    const requests = store(), user = userEvent.setup();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    mockServer.use(http.get("/api/blog/works/draft", () => HttpResponse.json({ work: {
      ...initial, elements: initial.elements.map(element => element.id === "photo" ? { ...element, caption: "回读图片" } : element),
    } })));
    render(editor());
    endpoint("连接照片：photo").focus(); await user.keyboard("{Enter}");
    fireEvent(document, new Event("visibilitychange"));
    expect(await screen.findByRole("button", { name: "连接照片：回读图片" })).toHaveAttribute("aria-pressed", "true");
    endpoint("连接博文：草稿正文").focus(); await user.keyboard("{Enter}");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].command).toMatchObject({ operation: "connection.create", data: { fromId: "photo", toId: "note" } });
  });

  it.each([false, true])("画板与草稿双向点击归属草稿：外部先选=%s；退出编辑清除外部起点", async externalFirst => {
    const requests = store(); navigation.params = new URLSearchParams("draft=draft");
    const external = { ...initial.elements[0], type: "photo" as const, imageUrl: "/photo.png", id: "external", caption: "外部图片" };
    render(<HomeTimelineBoard posts={[]} currentUserId="author" initialSnapshot={{ boardId: "home-board", elements: [external], connections: [] }} />);
    await screen.findByRole("button", { name: "退出草稿" });
    select(externalFirst ? "连接照片：外部图片" : "连接照片：photo");
    select(externalFirst ? "连接照片：photo" : "连接照片：外部图片");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ command: { operation: "connection.create", data: { fromId: "photo", toId: "external" } } });
    await screen.findByText("已自动保存", { exact: true });
    select("连接照片：外部图片");
    fireEvent.click(screen.getByRole("button", { name: "退出草稿" }));
    await waitFor(() => expect(endpoint("连接照片：外部图片")).toHaveAttribute("aria-pressed", "false"));
    expect(requests).toHaveLength(1);
  });

  it("普通画板失败反馈可见，再选两端成功，作品浏览态不能创建或删除所属连线", async () => {
    let writes = 0;
    mockServer.use(http.post("/api/home-board/connections", () => {
      writes++;
      return writes === 1 ? HttpResponse.json({}, { status: 500 }) : HttpResponse.json({ connection: { id: "normal", fromId: "photo", toId: "other-photo", color: "#668a5b" } });
    }));
    const view = render(<HomeTimelineBoard posts={[]} currentUserId="author" initialSnapshot={{ boardId: "home-board", elements: initial.elements.slice(0, 2).map(e => ({ ...e, type: "photo" as const, imageUrl: "/photo.png" })), connections: [] }} />);
    select("连接照片：photo"); select("连接照片：other-photo");
    expect(await screen.findByRole("alert")).toHaveTextContent("连线保存失败");
    select("连接照片：other-photo"); select("连接照片：photo");
    await screen.findByRole("button", { name: "删除连线 1" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    view.unmount();
    render(editor({ ...initial, status: "published", publishedAt: initial.updatedAt, connections: [{ id: "line", workId: "draft", fromId: "photo", toId: "note", color: "#72975a" }] }));
    expect(screen.queryByRole("button", { name: /连接照片/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /删除作品连线/ })).not.toBeInTheDocument();
  });
});

it("重复点击已连接的两端不提示错误，保留已有连线并继续保存后续接线", async () => {
  const connected: WorkSnapshot = { ...initial, connections: [{ id: "existing", workId: "draft", fromId: "photo", toId: "other-photo", color: "#72975a" }] };
  let attempts = 0;
  mockServer.use(http.patch("/api/blog/works/draft", async ({ request }) => {
    attempts++;
    if (attempts === 1) return HttpResponse.json({ code: "DUPLICATE_CONNECTION", error: "这两个元素已经连接" }, { status: 409 });
    const input = await request.json() as Body;
    if (input.command.operation !== "connection.create") throw new Error("预期接线操作");
    return HttpResponse.json({ work: { ...connected, revision: 1, connections: [...connected.connections, { id: "line", workId: "draft", ...input.command.data }] } });
  }));
  render(editor(connected));
  select("连接照片：photo"); select("连接照片：other-photo");
  await screen.findByText("已自动保存", { exact: true });
  expect(attempts).toBe(1);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText("保存失败", { exact: true })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /删除作品连线/ })).toHaveLength(1);
  select("连接照片：photo"); select("连接博文：草稿正文");
  await screen.findByRole("button", { name: "删除作品连线 2" });
  await screen.findByText("已自动保存", { exact: true });
  expect(attempts).toBe(2);
  expect(screen.getAllByRole("button", { name: /删除作品连线/ })).toHaveLength(2);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
