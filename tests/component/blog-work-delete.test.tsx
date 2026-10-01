import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkEditor } from "@/components/blog-work/WorkEditor";
import { HomeTimelineBoard } from "@/components/home/HomeTimelineBoard";
import type { BlogFeed, WorkSnapshot } from "@/lib/blog-work/types";
import type { MutationInput, WorkCommand } from "@/lib/blog-work/schemas";
import { mockServer } from "@/tests/mocks/server";

const navigation = vi.hoisted(() => ({ params: new URLSearchParams(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
  useSearchParams: () => navigation.params,
}));

const initial: WorkSnapshot = {
  id: "published-work", ownerId: "author", ownerName: "作者", status: "published", revision: 4,
  viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540, layoutWidth: 960,
  publishedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  canManage: true, posts: [], elements: [], connections: [],
};
const feed: BlogFeed = { entries: [{ kind: "work", work: initial }], nextCursor: null };
const snapshot = { boardId: "home-board", elements: [], connections: [] };
type RequestBody = MutationInput & { command: WorkCommand };
const board = () => <HomeTimelineBoard posts={[]} feed={feed} currentUserId="author" initialSnapshot={snapshot} />;

beforeEach(() => {
  navigation.params = new URLSearchParams(); navigation.refresh.mockClear();
  for (const name of ["ResizeObserver", "IntersectionObserver"]) vi.stubGlobal(name, class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mockServer.use(http.get(`/api/blog/works/${initial.id}`, () => HttpResponse.json({ work: initial })));
});
afterEach(() => vi.restoreAllMocks());

describe("已发布作品整组删除", () => {
  it.each([true, false])("仅作者在编辑时看到删除入口：canManage=%s", async canManage => {
    render(<WorkEditor initial={{ ...initial, canManage }} actorId={canManage ? "author" : "partner"} onClose={vi.fn()} onPublished={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "删除作品" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "编辑作品" }));
    expect(screen.getByRole("button", { name: "退出编辑" })).toBeEnabled();
    if (canManage) expect(screen.getByRole("button", { name: "删除作品" })).toBeEnabled();
    else expect(screen.queryByRole("button", { name: "删除作品" })).not.toBeInTheDocument();
  });

  it("键盘取消整组删除不写入且保留作品", async () => {
    const write = vi.fn(() => HttpResponse.json({ deleted: true }));
    mockServer.use(http.patch(`/api/blog/works/${initial.id}`, write));
    vi.mocked(window.confirm).mockReturnValue(false);
    render(board());
    await userEvent.click(screen.getByRole("button", { name: "编辑作品" }));
    screen.getByRole("button", { name: "删除作品" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("全部博文、图片和相关连线"));
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "已发布作品" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已自动保存");
  });

  it.each(["500", "network"])("删除 %s 失败保留作品，重试沿用幂等标识，成功后立即移除且旧列表不能复活", async failure => {
    const requests: RequestBody[] = [];
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    mockServer.use(http.patch(`/api/blog/works/${initial.id}`, async ({ request }) => {
      requests.push(await request.json() as RequestBody);
      expect(request.headers.get("X-Blog-Viewer-Id")).toBe("author");
      if (requests.length === 1) return failure === "network" ? HttpResponse.error() : HttpResponse.json({ error: "删除未确认" }, { status: 500 });
      await pending;
      return HttpResponse.json({ deleted: true, work: null });
    }));
    const view = render(board());
    await userEvent.click(screen.getByRole("button", { name: "编辑作品" }));
    await userEvent.click(screen.getByRole("button", { name: "删除作品" }));
    await screen.findByText("删除失败", { exact: true });
    expect(screen.getByRole("region", { name: "已发布作品" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除作品" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "退出编辑" })).toBeDisabled();
    for (const button of within(screen.getByRole("toolbar")).getAllByRole("button")) expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "重试删除" }));
    await screen.findByText("删除中…");
    await userEvent.click(screen.getByRole("button", { name: "删除作品" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0]).toMatchObject({ baseRevision: 4, expectedStatus: "published", command: { operation: "delete" } });
    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole("region", { name: "已发布作品" })).not.toBeInTheDocument());
    view.rerender(board());
    expect(screen.queryByRole("region", { name: "已发布作品" })).not.toBeInTheDocument();
  });

  it.each([false, true])("删除冲突不自动覆盖，可取消或再次确认删除：继续=%s", async keepDeleting => {
    const requests: RequestBody[] = [], onDeleted = vi.fn();
    mockServer.use(
      http.get(`/api/blog/works/${initial.id}`, () => HttpResponse.json({ work: { ...initial, revision: 5 } })),
      http.patch(`/api/blog/works/${initial.id}`, async ({ request }) => {
        requests.push(await request.json() as RequestBody);
        return requests.length === 1
          ? HttpResponse.json({ code: "REVISION_CONFLICT", error: "作品已有更新" }, { status: 409 })
          : HttpResponse.json({ deleted: true, work: null });
      }),
    );
    render(<WorkEditor initial={initial} actorId="author" editable onClose={vi.fn()} onPublished={vi.fn()} onDeleted={onDeleted} />);
    await userEvent.click(screen.getByRole("button", { name: "删除作品" }));
    await screen.findByText("删除冲突", { exact: true });
    expect(requests).toHaveLength(1); expect(onDeleted).not.toHaveBeenCalled();
    if (keepDeleting) {
      vi.mocked(window.confirm).mockReturnValueOnce(false);
      await userEvent.click(screen.getByRole("button", { name: "确认删除最新作品" }));
      expect(requests).toHaveLength(1);
      await userEvent.click(screen.getByRole("button", { name: "确认删除最新作品" }));
      await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(initial.id));
      expect(requests[1].baseRevision).toBe(5);
      expect(requests[1].mutationId).not.toBe(requests[0].mutationId);
    } else {
      await userEvent.click(screen.getByRole("button", { name: "取消删除并采用最新内容" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "删除作品" })).toBeEnabled());
      expect(screen.getByRole("status")).toHaveTextContent("已自动保存");
      expect(requests).toHaveLength(1); expect(onDeleted).not.toHaveBeenCalled();
    }
  });

  it("深链编辑中删除同步关闭工作区并移除背景时间线", async () => {
    navigation.params = new URLSearchParams(`work=${initial.id}`);
    mockServer.use(http.patch(`/api/blog/works/${initial.id}`, () => HttpResponse.json({ deleted: true, work: null })));
    render(board());
    await userEvent.click(await screen.findByRole("button", { name: "删除作品" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "已发布作品" })).not.toBeInTheDocument());
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("作品已被另一标签页删除时关闭旧编辑器，不陷入无法退出的删除冲突", async () => {
    mockServer.use(http.patch(`/api/blog/works/${initial.id}`, () => HttpResponse.json({ code: "NOT_FOUND", error: "作品不可用" }, { status: 404 })));
    render(board());
    await userEvent.click(screen.getByRole("button", { name: "编辑作品" }));
    await userEvent.click(screen.getByRole("button", { name: "删除作品" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "已发布作品" })).not.toBeInTheDocument());
    expect(screen.queryByText("删除冲突")).not.toBeInTheDocument();
  });
});
