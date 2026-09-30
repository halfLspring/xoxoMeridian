import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { HomeBoardSnapshot } from "@/components/home/types";
import { mockServer } from "@/tests/mocks/server";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/blog/Timeline", () => ({ Timeline: () => null }));
vi.mock("@/components/home/HomeUploadModal", () => ({ HomeUploadModal: () => null }));

import { HomeTimelineBoard } from "@/components/home/HomeTimelineBoard";

const snapshot: HomeBoardSnapshot = {
  boardId: "home-board",
  elements: [1, 2].map((id) => ({
    id: `photo-${id}`,
    type: "photo" as const,
    x: id * 40,
    y: 80,
    rotation: 0,
    zIndex: 1,
    content: null,
    imageUrl: `/api/atlas/uploads/photo-${id}.jpg`,
    caption: `旅行照片 ${id}`,
    width: 240,
    height: 180,
    createdById: "user-1",
    createdAt: "2026-09-29T00:00:00.000Z",
    postId: null,
  })),
  connections: [],
};

function rotationHandle(index = 1) {
  const handle = screen.getByRole("button", { name: `旋转照片：旅行照片 ${index}` });
  Object.assign(handle, {
    setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
  });
  return handle;
}

describe("Home photo rotation", () => {
  it("shows only the edited photo at the chosen angle and retries a failed save", async () => {
    const requests: Array<{ rotation: number }> = [];
    mockServer.use(http.patch("/api/home-board/elements/photo-1", async ({ request }) => {
      requests.push(await request.json() as { rotation: number });
      return HttpResponse.json({}, { status: requests.length === 1 ? 503 : 200 });
    }));

    render(<HomeTimelineBoard posts={[]} currentUserId="user-1" initialSnapshot={snapshot} />);
    const handle = rotationHandle();
    const firstPhoto = screen.getByRole("img", { name: "旅行照片 1" }).closest<HTMLElement>("[data-home-photo]")!;
    const secondPhoto = screen.getByRole("img", { name: "旅行照片 2" }).closest<HTMLElement>("[data-home-photo]")!;
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    await userEvent.click(handle);
    const angle = screen.getByRole("spinbutton", { name: "照片旋转角度" });
    await userEvent.clear(angle);
    await userEvent.type(angle, "25");
    await userEvent.click(screen.getByRole("button", { name: "应用角度" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("照片角度保存失败");
    expect(firstPhoto).toHaveStyle({ transform: "rotate(25deg)" });
    expect(secondPhoto).toHaveStyle({ transform: "rotate(0deg)" });
    expect(requests).toEqual([{ rotation: 25 }]);

    await userEvent.click(screen.getByRole("button", { name: "重试保存照片角度" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(requests).toEqual([{ rotation: 25 }, { rotation: 25 }]);
  });
  it("closes the angle editor when another photo receives a pointer action", async () => {
    render(<HomeTimelineBoard posts={[]} currentUserId="user-1" initialSnapshot={snapshot} />);
    const first = rotationHandle();
    const second = rotationHandle(2);
    await userEvent.click(first);
    expect(screen.getAllByRole("spinbutton", { name: "照片旋转角度" })).toHaveLength(1);
    await userEvent.click(second);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("spinbutton", { name: "照片旋转角度" })).toHaveLength(1);
  });

  it("supports precise keyboard changes, the 25 degree limit and resetting to level", async () => {
    mockServer.use(http.patch("/api/home-board/elements/photo-1", () => HttpResponse.json({})));
    render(<HomeTimelineBoard posts={[]} currentUserId="user-1" initialSnapshot={snapshot} />);
    const handle = rotationHandle();
    const photo = screen.getByRole("img", { name: "旅行照片 1" }).closest<HTMLElement>("[data-home-photo]")!;
    handle.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(photo).toHaveStyle({ transform: "rotate(1deg)" });
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(photo).toHaveStyle({ transform: "rotate(6deg)" });
    await userEvent.keyboard("{Shift>}{ArrowRight>5/}{/Shift}");
    expect(photo).toHaveStyle({ transform: "rotate(25deg)" });
    await userEvent.keyboard("{Home}");
    expect(photo).toHaveStyle({ transform: "rotate(0deg)" });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it.each(["pointerCancel", "lostPointerCapture"] as const)("previews without saving and restores on %s, ignoring later pointer moves", (cancelEvent) => {
    const requests = vi.fn();
    mockServer.use(http.patch("/api/home-board/elements/photo-1", () => {
      requests();
      return HttpResponse.json({});
    }));
    render(<HomeTimelineBoard posts={[]} currentUserId="user-1" initialSnapshot={snapshot} />);
    const handle = rotationHandle();
    const photo = screen.getByRole("img", { name: "旅行照片 1" }).closest<HTMLElement>("[data-home-photo]")!;
    vi.spyOn(photo, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 80, 240, 180));
    const at = (degrees: number) => ({
      clientX: 160 + 150 * Math.cos(degrees * Math.PI / 180),
      clientY: 170 + 150 * Math.sin(degrees * Math.PI / 180),
      pointerId: 1, isPrimary: true, button: 0,
    });
    fireEvent.pointerDown(handle, at(-150));
    fireEvent.pointerMove(handle, at(-130));
    expect(photo).toHaveStyle({ transform: "rotate(20deg)" });
    expect(requests).not.toHaveBeenCalled();
    fireEvent[cancelEvent](handle, at(-130));
    expect(photo).toHaveStyle({ transform: "rotate(0deg)" });
    fireEvent.pointerMove(handle, at(-125));
    fireEvent.pointerUp(handle, at(-125));
    expect(photo).toHaveStyle({ transform: "rotate(0deg)" });
    expect(requests).not.toHaveBeenCalled();
  });

  it("crosses the negative 180 degree pointer boundary without jumping or saving twice", async () => {
    const writes: unknown[] = [];
    mockServer.use(http.patch("/api/home-board/elements/photo-1", async ({ request }) => {
      writes.push(await request.json());
      return HttpResponse.json({});
    }));
    render(<HomeTimelineBoard posts={[]} currentUserId="user-1" initialSnapshot={snapshot} />);
    const handle = rotationHandle();
    const photo = screen.getByRole("img", { name: "旅行照片 1" }).closest<HTMLElement>("[data-home-photo]")!;
    vi.spyOn(photo, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 80, 240, 180));
    const at = (degrees: number) => ({
      clientX: 160 + 150 * Math.cos(degrees * Math.PI / 180),
      clientY: 170 + 150 * Math.sin(degrees * Math.PI / 180),
      pointerId: 1, isPrimary: true, button: 0,
    });
    fireEvent.pointerDown(handle, at(-175));
    fireEvent.pointerMove(handle, at(175));
    expect(photo).toHaveStyle({ transform: "rotate(-10deg)" });
    expect(writes).toEqual([]);
    fireEvent.pointerUp(handle, at(175));
    fireEvent.lostPointerCapture(handle, at(175));
    await waitFor(() => expect(writes).toEqual([{ rotation: -10 }]));
    expect(photo).toHaveStyle({ transform: "rotate(-10deg)" });
  });
});
