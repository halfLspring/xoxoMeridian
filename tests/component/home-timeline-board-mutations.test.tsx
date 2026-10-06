import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { HomeBoardSnapshot } from "@/components/home/types";
import { mockServer } from "@/tests/mocks/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/blog/Timeline", () => ({ Timeline: () => null }));
vi.mock("@/components/home/HomeUploadModal", () => ({ HomeUploadModal: () => null }));

import { HomeTimelineBoard } from "@/components/home/HomeTimelineBoard";

const initialSnapshot: HomeBoardSnapshot = {
  boardId: "home-board",
  elements: [1, 2].map((id) => ({
    id: `photo-${id}`,
    type: "photo",
    x: id * 30,
    y: 20,
    rotation: 0,
    zIndex: 1,
    content: null,
    imageUrl: `/api/atlas/uploads/photo-${id}.jpg`,
    caption: `旅行照片 ${id}`,
    width: 240,
    height: 180,
    createdById: "user-1",
    createdAt: "2026-09-12T00:00:00.000Z",
    postId: null,
  })),
  connections: [{ id: "connection-1", fromId: "photo-1", toId: "photo-2", color: "#668a5b" }],
};

function mountBoard() {
  return render(<HomeTimelineBoard posts={[]} currentUserId="user-1" initialSnapshot={initialSnapshot} />);
}

function photoCard(name = "旅行照片 1") {
  return screen.getByRole("img", { name }).closest<HTMLElement>("[data-home-photo]")!;
}

async function editCaption(caption: string, current = "旅行照片 1") {
  await userEvent.click(screen.getByRole("button", { name: current }));
  // 初始负向对照也须能操作原有未命名字段，label 另有键盘回归覆盖。
  const input = screen.getByRole("textbox");
  await userEvent.clear(input);
  await userEvent.type(input, `${caption}{Enter}`);
}

function resizePhoto(dx = 80) {
  const handle = within(photoCard()).getByTitle("调整大小");
  fireEvent.pointerDown(handle, { button: 0, isPrimary: true, clientX: 240, clientY: 180, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 240 + dx, clientY: 180, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: 240 + dx, clientY: 180, pointerId: 1 });
}

function connectionHitTarget() {
  return document.querySelector("svg.home-connection-layer path")!;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("HomeTimelineBoard mutation recovery", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => true });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: vi.fn() });
  });
  afterAll(() => { Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture"); Reflect.deleteProperty(HTMLElement.prototype, "hasPointerCapture"); Reflect.deleteProperty(HTMLElement.prototype, "releasePointerCapture"); });

  for (const failure of ["500", "network"] as const) {
    it.each(["resize", "caption", "photo-delete", "connection-delete"] as const)(
      `keeps %s recoverable after ${failure} and confirms only a successful retry`,
      async (operation) => {
        const release = deferred();
        let attempts = 0;
        const respond = async () => {
          attempts += 1;
          if (attempts === 1) {
            return failure === "network" ? HttpResponse.error() : HttpResponse.json({}, { status: 500 });
          }
          await release.promise;
          return HttpResponse.json({ deleted: true, element: initialSnapshot.elements[0] });
        };
        mockServer.use(
          http.patch("/api/home-board/elements/photo-1", respond),
          http.delete("/api/home-board/elements/photo-1", respond),
          http.delete("/api/home-board/connections", respond),
        );
        mountBoard();
        const card = photoCard();
        if (operation === "resize") resizePhoto();
        if (operation === "caption") await editCaption("新的标注");
        if (operation === "photo-delete") await userEvent.click(within(card).getByTitle("删除"));
        if (operation === "connection-delete") fireEvent.click(connectionHitTarget());

        const label = { resize: "照片大小保存", caption: "照片标注保存", "photo-delete": "照片删除", "connection-delete": "连线删除" }[operation];
        expect(await screen.findByRole("alert")).toHaveTextContent(`${label}失败`);
        expect(card).toBeInTheDocument();
        expect(connectionHitTarget()).toBeInTheDocument();
        if (operation === "resize") expect(card.style.getPropertyValue("--home-photo-width")).toBe("320px");
        if (operation === "caption") expect(screen.getByRole("img", { name: "新的标注" })).toBeVisible();

        const retryName = { resize: "重试保存照片大小", caption: "重试保存照片标注", "photo-delete": "重试删除照片", "connection-delete": "重试删除连线" }[operation];
        await userEvent.click(screen.getByRole("button", { name: retryName }));
        await waitFor(() => expect(attempts).toBe(2));
        expect(screen.getByRole("status")).toBeVisible();
        expect(card).toBeInTheDocument();
        expect(connectionHitTarget()).toBeInTheDocument();
        release.resolve();
        await waitFor(() => {
          expect(screen.queryByRole("alert")).not.toBeInTheDocument();
          expect(screen.queryByRole("status")).not.toBeInTheDocument();
        });
        if (operation === "photo-delete") expect(card).not.toBeInTheDocument();
        if (operation.endsWith("delete")) expect(connectionHitTarget()).not.toBeInTheDocument();
        expect(attempts).toBe(2);
      },
    );
  }

  it.each([200, 500])("keeps the latest edits after a delayed %s PATCH and serializes different photo fields", async (status) => {
    const first = deferred();
    const requests: Array<Record<string, unknown>> = [];
    mockServer.use(http.patch("/api/home-board/elements/photo-1", async ({ request }) => {
      requests.push(await request.json() as Record<string, unknown>);
      if (requests.length === 1) {
        await first.promise;
        return HttpResponse.json({ element: initialSnapshot.elements[0] }, { status });
      }
      return HttpResponse.json({ element: initialSnapshot.elements[0] });
    }));
    mountBoard();
    resizePhoto();
    await waitFor(() => expect(requests).toHaveLength(1));
    await editCaption("第一版");
    await editCaption("最终版", "第一版");
    expect(requests).toHaveLength(1);
    first.resolve();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(requests).toEqual([
      { width: 320, height: 240 },
      status === 500 ? { width: 320, height: 240, caption: "最终版" } : { caption: "最终版" },
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(photoCard("最终版").style.getPropertyValue("--home-photo-width")).toBe("320px");
    await userEvent.click(screen.getByRole("button", { name: "最终版" }));
    expect(screen.getByLabelText("照片标注")).toHaveValue("最终版");
  });

  it("preserves failed fields when a later edit succeeds and normalizes the caption before display", async () => {
    const requests: Array<Record<string, unknown>> = [];
    mockServer.use(http.patch("/api/home-board/elements/photo-1", async ({ request }) => {
      requests.push(await request.json() as Record<string, unknown>);
      return HttpResponse.json({}, { status: requests.length === 1 ? 500 : 200 });
    }));
    mountBoard();
    await editCaption("  新的标注  ");
    expect(await screen.findByRole("alert")).toBeVisible();
    const handle = within(photoCard("新的标注")).getByRole("button", { name: /调整照片大小/ });
    handle.focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(requests).toEqual([{ caption: "新的标注" }, { caption: "新的标注", width: 250, height: 188 }]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("waits for an active edit before deleting and never loses the photo or its connection on delete failure", async () => {
    const patch = deferred();
    const deletion = deferred();
    const methods: string[] = [];
    mockServer.use(
      http.patch("/api/home-board/elements/photo-1", async () => {
        methods.push("PATCH");
        await patch.promise;
        return HttpResponse.json({});
      }),
      http.delete("/api/home-board/elements/photo-1", async () => {
        methods.push("DELETE");
        await deletion.promise;
        return HttpResponse.json({}, { status: methods.length === 2 ? 500 : 200 });
      }),
    );
    mountBoard();
    await editCaption("编辑已保留");
    await userEvent.click(within(photoCard("编辑已保留")).getByTitle("删除"));
    expect(methods).toEqual(["PATCH"]);
    expect(screen.getByRole("button", { name: "编辑已保留" })).toBeDisabled();
    patch.resolve();
    await waitFor(() => expect(methods).toEqual(["PATCH", "DELETE"]));
    deletion.resolve();
    expect(await screen.findByRole("alert")).toHaveTextContent("照片删除失败");
    expect(photoCard("编辑已保留")).toBeInTheDocument();
    expect(connectionHitTarget()).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试删除照片" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "编辑已保留" })).not.toBeInTheDocument());
    expect(connectionHitTarget()).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("allows keyboard connection deletion and keeps another photo intact", async () => {
    mockServer.use(http.delete("/api/home-board/connections", () => HttpResponse.json({ deleted: true })));
    mountBoard();
    const connection = screen.getByRole("button", { name: /删除连线/ });
    connection.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(connection).not.toBeInTheDocument());
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("discards a late connection failure after its photo was successfully deleted", async () => {
    const connection = deferred();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mockServer.use(
      http.delete("/api/home-board/connections", async () => {
        await connection.promise;
        return HttpResponse.json({}, { status: 500 });
      }),
      http.delete("/api/home-board/elements/photo-1", () => HttpResponse.json({ deleted: true })),
    );
    mountBoard();
    const hitTarget = screen.getByRole("button", { name: /删除连线/ });
    fireEvent.click(hitTarget);
    expect(await screen.findByRole("status")).toHaveTextContent("正在删除连线");
    await userEvent.click(within(photoCard()).getByRole("button", { name: /删除照片/ }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "旅行照片 1" })).not.toBeInTheDocument());
    expect(hitTarget).not.toBeInTheDocument();
    await act(async () => {
      connection.resolve();
      await fetchSpy.mock.results[0].value;
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "旅行照片 2" })).toBeVisible();
  });
});
