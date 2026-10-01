import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { BlogWorkspace } from "@/components/blog-work/BlogWorkspace";
import { BlogActionProvider } from "@/components/blog-work/BlogActionProvider";
import { HomeContextMenu } from "@/components/home/HomeContextMenu";
import { mockServer } from "@/tests/mocks/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

describe("草稿创建反馈", () => {
  it("创建中只由页面级 status 播报，失败改由 alert 承担并保留同键重试", async () => {
    const bodies: Array<{ mutationId: string }> = []; let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    mockServer.use(http.post("/api/blog/works", async ({ request }) => { bodies.push(await request.json() as { mutationId: string }); await pending; return HttpResponse.json({ error: "创建失败" }, { status: 500 }); }));
    render(<BlogActionProvider><HomeContextMenu state={{ screenX: 0, screenY: 0, boardX: 0, boardY: 0 }} onAddPhoto={() => {}} /><BlogWorkspace actorId="author" /></BlogActionProvider>);
    await userEvent.click(screen.getByRole("button", { name: "新增草稿" }));
    const help = await screen.findByRole("group", { name: "框选草稿区域" });
    expect(help).not.toHaveAttribute("data-revealed");
    // 卡片不再自带状态播报，避免与页面级提示重复。
    expect(help).not.toHaveTextContent(/正在创建|创建失败/);
    await userEvent.click(screen.getByRole("button", { name: "使用默认区域" }));
    expect(await screen.findByRole("status")).toHaveTextContent("正在创建草稿…");
    await act(async () => { release(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("创建失败，请重试");
    expect(screen.queryByRole("status")).toBeNull();
    expect(help).toHaveAttribute("data-revealed");
    await userEvent.click(screen.getByRole("button", { name: "重试创建" }));
    await waitFor(() => expect(bodies).toHaveLength(2)); expect(bodies[1].mutationId).toBe(bodies[0].mutationId);
    expect(bodies[0]).toMatchObject({ draftX: 24, viewportWidth: 960, viewportHeight: 540 });
  });
});
