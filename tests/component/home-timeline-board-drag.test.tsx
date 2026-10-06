import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { mockServer } from "@/tests/mocks/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/blog/Timeline", () => ({
  Timeline: () => null,
}));

vi.mock("@/components/home/HomeUploadModal", () => ({
  HomeUploadModal: () => null,
}));

import { HomeTimelineBoard } from "@/components/home/HomeTimelineBoard";

const initialSnapshot = {
  boardId: "home-board",
  elements: [
    {
      id: "photo-1",
      type: "photo" as const,
      x: 10,
      y: 20,
      rotation: 0,
      zIndex: 1,
      content: null,
      imageUrl: "/api/atlas/uploads/photo-1.jpg",
      caption: "旅行照片",
      width: 240,
      height: 180,
      createdById: "user-1",
      createdAt: "2026-09-07T00:00:00.000Z",
      postId: null,
    },
  ],
  connections: [],
};

function dragPhoto(from: { x: number; y: number }, to: { x: number; y: number }) {
  const photo = screen.getByRole("img", { name: "旅行照片" }).closest("[data-home-photo]");
  expect(photo).not.toBeNull();
  fireEvent.pointerDown(photo!, { button: 0, isPrimary: true, clientX: from.x, clientY: from.y, pointerId: 1 });
  fireEvent.pointerUp(photo!, { clientX: to.x, clientY: to.y, pointerId: 1 });
}

describe("HomeTimelineBoard drag persistence", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => true });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: vi.fn() });
  });

  afterAll(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture"); Reflect.deleteProperty(HTMLElement.prototype, "hasPointerCapture"); Reflect.deleteProperty(HTMLElement.prototype, "releasePointerCapture");
  });

  it("shows a retry action after a failed final position write and clears it after success", async () => {
    const requests: Array<{ x: number; y: number }> = [];
    let attempt = 0;
    mockServer.use(
      http.patch("/api/home-board/elements/photo-1", async ({ request }) => {
        requests.push(await request.json() as { x: number; y: number });
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ error: "temporary failure" }, { status: 503 });
        }

        return HttpResponse.json({
          element: {
            ...initialSnapshot.elements[0],
            x: 120,
            y: 180,
          },
        });
      })
    );

    render(
      <HomeTimelineBoard
        posts={[]}
        currentUserId="user-1"
        initialSnapshot={initialSnapshot}
      />
    );

    dragPhoto({ x: 10, y: 20 }, { x: 120, y: 180 });

    expect(await screen.findByRole("alert")).toHaveTextContent("照片位置保存失败");
    expect(requests).toEqual([{ x: 120, y: 180 }]);

    await userEvent.click(screen.getByRole("button", { name: "重试保存照片位置" }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
    expect(requests).toEqual([
      { x: 120, y: 180 },
      { x: 120, y: 180 },
    ]);
  });

  it("serializes repeated final writes so an older request cannot overwrite the newest position", async () => {
    const requests: Array<{ x: number; y: number }> = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let releaseFirstRequest!: () => void;
    const firstRequestBlocked = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });

    mockServer.use(
      http.patch("/api/home-board/elements/photo-1", async ({ request }) => {
        const position = await request.json() as { x: number; y: number };
        requests.push(position);
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        if (requests.length === 1) {
          await firstRequestBlocked;
        }
        activeRequests -= 1;
        return HttpResponse.json({
          element: { ...initialSnapshot.elements[0], ...position },
        });
      })
    );

    render(
      <HomeTimelineBoard
        posts={[]}
        currentUserId="user-1"
        initialSnapshot={initialSnapshot}
      />
    );

    dragPhoto({ x: 10, y: 20 }, { x: 120, y: 180 });
    await waitFor(() => expect(requests).toHaveLength(1));

    dragPhoto({ x: 120, y: 180 }, { x: 210, y: 260 });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(requests).toHaveLength(1);

    releaseFirstRequest();

    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(requests).toEqual([
      { x: 120, y: 180 },
      { x: 210, y: 260 },
    ]);
    expect(maxActiveRequests).toBe(1);
  });
});
