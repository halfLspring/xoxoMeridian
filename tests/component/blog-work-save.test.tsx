import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { useWorkMutations } from "@/components/blog-work/useWorkMutations";
import type { WorkSnapshot } from "@/lib/blog-work/types";
import { mockServer } from "@/tests/mocks/server";
const initial: WorkSnapshot = { id: "work-test", ownerId: "author", ownerName: "作者", status: "draft", revision: 0, viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540, layoutWidth: 960, draftX: 0, draftY: 0, publishedAt: null, updatedAt: "2026-09-30T00:00:00Z", canManage: true, posts: [], elements: [], connections: [] };
function Harness() {
  const save = useWorkMutations(initial, "author");
  return <><p role="status" aria-label="保存状态">{save.state}</p><output>{save.work.revision}</output><p role="alert">{save.error}</p>
    <button onClick={() => void save.enqueue({ operation: "frame", data: { viewportWidth: 800 } })}>修改宽度</button>
    <button onClick={() => void save.enqueue({ operation: "frame", data: { viewportHeight: 400 } })}>修改高度</button>
    <button onClick={save.retry}>重试</button><button onClick={() => void save.resolveConflict(true)}>保留本地</button><button onClick={() => void save.resolveConflict(false)}>采用服务器</button></>;
}
describe("作品保存队列", () => {
  it("失败保留幂等标识，串行后续写入采用确认后的版本", async () => {
    const requests: Array<{ mutationId: string; baseRevision: number }> = []; let fail = true;
    mockServer.use(http.patch("/api/blog/works/work-test", async ({ request }) => {
      const input = await request.json() as { mutationId: string; baseRevision: number }; requests.push(input);
      if (fail) { fail = false; return HttpResponse.json({ error: "未确认保存" }, { status: 500 }); }
      return HttpResponse.json({ work: { ...initial, revision: input.baseRevision + 1 } });
    }));
    render(<Harness />); await userEvent.click(screen.getByText("修改宽度")); await screen.findByText("failed");
    await userEvent.click(screen.getByText("修改高度")); expect(requests).toHaveLength(1);
    await userEvent.click(screen.getByText("重试")); await waitFor(() => expect(screen.getByRole("status", { name: "保存状态" })).toHaveTextContent("clean"));
    expect(requests.map(r => r.baseRevision)).toEqual([0, 0, 1]); expect(requests[0].mutationId).toBe(requests[1].mutationId); expect(requests[2].mutationId).not.toBe(requests[1].mutationId);
  });
  it("相同字段冲突暂停，明确选择后使用新幂等键重提", async () => {
    const requests: Array<{ mutationId: string; baseRevision: number }> = [];
    mockServer.use(http.get("/api/blog/works/work-test", () => HttpResponse.json({ work: { ...initial, revision: 2, viewportWidth: 700 } })), http.patch("/api/blog/works/work-test", async ({ request }) => {
      const data = await request.json() as { mutationId: string; baseRevision: number }; requests.push(data);
      return requests.length === 1 ? HttpResponse.json({ code: "REVISION_CONFLICT", error: "冲突" }, { status: 409 }) : HttpResponse.json({ work: { ...initial, revision: 3, viewportWidth: 800 } });
    }));
    render(<Harness />); await userEvent.click(screen.getByText("修改宽度")); await screen.findByText("conflict"); expect(requests).toHaveLength(1);
    await userEvent.click(screen.getByText("保留本地")); await screen.findByText("clean"); expect(requests[1].baseRevision).toBe(2); expect(requests[1].mutationId).not.toBe(requests[0].mutationId);
  });
  it("迟到草稿不能自动重放成公开修改", async () => {
    let writes = 0;
    mockServer.use(http.get("/api/blog/works/work-test", () => HttpResponse.json({ work: { ...initial, revision: 2, status: "published" } })), http.patch("/api/blog/works/work-test", () => { writes++; return HttpResponse.json({ code: "STATUS_CONFLICT", error: "状态改变" }, { status: 409 }); }));
    render(<Harness />); await userEvent.click(screen.getByText("修改宽度")); await screen.findByText("conflict"); await userEvent.click(screen.getByText("保留本地"));
    expect(screen.getByRole("alert")).toHaveTextContent("不能把迟到修改自动公开"); expect(writes).toBe(1);
  });
  it("发布响应前入队的草稿操作仍携带 draft 前置条件", async () => {
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; }), statuses: string[] = [];
    mockServer.use(http.patch("/api/blog/works/work-test", async ({ request }) => {
      const input = await request.json() as { expectedStatus: string }; statuses.push(input.expectedStatus);
      if (statuses.length === 1) { await delayed; return HttpResponse.json({ work: { ...initial, status: "published", revision: 1 } }); }
      return HttpResponse.json({ code: "STATUS_CONFLICT", error: "作品已发布" }, { status: 409 });
    }));
    render(<Harness />); await userEvent.click(screen.getByText("修改宽度")); await userEvent.click(screen.getByText("修改高度"));
    await act(async () => release()); await screen.findByText("conflict"); expect(statuses).toEqual(["draft", "draft"]);
  });
  it("卸载后迟到响应不会继续发送下一项", async () => {
    let release!: () => void; const delayed = new Promise<void>(done => { release = done; }); let count = 0;
    mockServer.use(http.patch("/api/blog/works/work-test", async () => { count++; await delayed; return HttpResponse.json({ work: { ...initial, revision: 1 } }); }));
    const rendered = render(<Harness />); await userEvent.click(screen.getByText("修改宽度")); await userEvent.click(screen.getByText("修改高度"));
    rendered.unmount(); await act(async () => release()); expect(count).toBe(1);
  });
  it("401 停止私密写入，重试和后续编辑不会继续发请求", async () => {
    let count = 0;
    mockServer.use(http.patch("/api/blog/works/work-test", () => { count++; return HttpResponse.text("Unauthorized", { status: 401 }); }));
    render(<Harness />); await userEvent.click(screen.getByText("修改宽度")); await screen.findByText("auth-invalid");
    await userEvent.click(screen.getByText("修改高度")); await userEvent.click(screen.getByText("重试"));
    expect(count).toBe(1);
  });
});
