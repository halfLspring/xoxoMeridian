import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkEditor } from "@/components/blog-work/WorkEditor";
import type { MutationInput, WorkCommand } from "@/lib/blog-work/schemas";
import type { WorkSnapshot } from "@/lib/blog-work/types";
import { mockServer } from "@/tests/mocks/server";

const initial: WorkSnapshot = {
  id: "photo-work", ownerId: "author", ownerName: "作者", status: "draft", revision: 0,
  viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540, layoutWidth: 960,
  publishedAt: null, updatedAt: "2026-10-04T00:00:00Z", canManage: true, posts: [], connections: [],
  elements: [{ id: "photo", workId: "photo-work", postId: null, type: "photo", x: 80, y: 120, width: 240, height: 180, rotation: 0,
    zIndex: 1, content: null, imageUrl: "/photo.png", caption: "连续编辑", createdById: "author", createdAt: "2026-10-04T00:00:00Z" }],
};
type RequestBody = MutationInput & { command: WorkCommand };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});

describe("图片连续编辑的保存响应", () => {
  it.each([
    { name: "回到旧基线", repeatValue: false, failFirst: false },
    { name: "再次使用较早的待确认值", repeatValue: true, failFirst: false },
    { name: "保存失败后回到旧基线并重试", repeatValue: false, failFirst: true },
  ])("$name 时，旧响应保留最新尺寸及后续键盘编辑的基线", async ({ repeatValue, failFirst }) => {
    const user = userEvent.setup(), onChanged = vi.fn();
    const requests: RequestBody[] = [];
    const replies = Array.from({ length: 4 }, () => {
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      return { pending, release };
    });
    let stored = initial, replyIndex = 0;
    mockServer.use(
      http.get(`/api/blog/works/${initial.id}`, () => HttpResponse.json({ work: stored })),
      http.patch(`/api/blog/works/${initial.id}`, async ({ request }) => {
        const input = await request.json() as RequestBody;
        requests.push(input);
        if (failFirst && requests.length === 1) return HttpResponse.json({ error: "保存未确认" }, { status: 500 });
        await replies[replyIndex++].pending;
        if (input.command.operation !== "photo.update") return HttpResponse.json({ error: "非图片操作" }, { status: 400 });
        stored = { ...stored, revision: input.baseRevision + 1, elements: [{ ...stored.elements[0], ...input.command.data }] };
        return HttpResponse.json({ work: stored });
      }),
    );
    const view = render(<WorkEditor initial={initial} actorId="author" onClose={vi.fn()} onPublished={vi.fn()} onDeleted={vi.fn()} onChanged={onChanged} />);
    const resize = screen.getByRole("button", { name: "调整照片大小：连续编辑" });
    const photo = screen.getByRole("img", { name: "连续编辑" }).closest<HTMLElement>("[data-home-photo]")!;
    const expectWidth = (width: number) => expect(photo.style.getPropertyValue("--home-photo-width")).toBe(`${width}px`);
    const acknowledge = async (index: number) => {
      await act(async () => replies[index].release());
      await waitFor(() => expect(onChanged).toHaveBeenLastCalledWith(expect.objectContaining({ revision: index + 1 })));
    };
    try {
      resize.focus();
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(requests).toHaveLength(1));
      if (failFirst) await screen.findByText("保存失败", { exact: true });
      await user.keyboard("{ArrowLeft}");
      expectWidth(240);
      if (repeatValue) await user.keyboard("{ArrowRight}");
      if (failFirst) await user.click(screen.getByRole("button", { name: "重试保存" }));
      await acknowledge(0);
      expectWidth(repeatValue ? 250 : 240);
      if (repeatValue) {
        await acknowledge(1);
        expectWidth(250);
      }
      resize.focus();
      await user.keyboard("{ArrowRight}");
      const expectedWidth = repeatValue ? 260 : 250;
      expectWidth(expectedWidth);
      expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
      for (let index = repeatValue ? 2 : 1; index < (repeatValue ? 4 : 3); index++) {
        await acknowledge(index);
        expectWidth(expectedWidth);
      }
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已自动保存"));
      expect(screen.getByRole("button", { name: "发布" })).toBeEnabled();
      const savedRequests = failFirst ? requests.slice(1) : requests;
      expect(savedRequests.map(input => input.command.operation === "photo.update" && input.command.data.width))
        .toEqual(repeatValue ? [250, 240, 250, 260] : [250, 240, 250]);
      expect(savedRequests.map(input => input.baseRevision)).toEqual(repeatValue ? [0, 1, 2, 3] : [0, 1, 2]);
      expect(stored.elements[0].width).toBe(expectedWidth);
      if (failFirst) expect(requests[1]).toEqual(requests[0]);
    } finally {
      view.unmount();
      await act(async () => replies.forEach(reply => reply.release()));
    }
  });
});
