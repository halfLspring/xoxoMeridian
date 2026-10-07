import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PostCard } from "@/components/blog/PostCard";
import { WorkCanvas } from "@/components/blog-work/WorkCanvas";
import { CanvasConnection } from "@/components/home/CanvasConnection";
import type { WorkSnapshot } from "@/lib/blog-work/types";

const content = "摘要 **English**\n\n- 中文列表\n\n" + "很长的正文".repeat(100) + "结尾不能保存丢失";
const work: WorkSnapshot = {
  id: "work", ownerId: "owner", ownerName: "作者", status: "draft", revision: 0, layoutWidth: 960,
  viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540,
  publishedAt: null, updatedAt: "2026-10-01T00:00:00Z", canManage: true,
  posts: [{ id: "post", elementId: "element", workOrder: 0, title: "标题", content, publishedAt: null, slug: null }],
  elements: [], connections: [],
};

beforeEach(() => {
  // 本层只检查内容与键盘回调；真实尺寸/字体由 Playwright 验证。
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(180);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

afterEach(() => vi.restoreAllMocks());

it("作品摘要可键盘打开全文或选择端点，空文不会写入占位内容", async () => {
  const onPost = vi.fn(), onSelect = vi.fn();
  const props = { work, scale: 1, editing: true, onPost, onSelect, onPhotoPreview: vi.fn(), onPhotoCommit: vi.fn(), onDeletePhoto: vi.fn() };
  const view = render(<WorkCanvas {...props} />);
  expect(screen.getByRole("article")).not.toHaveTextContent("结尾不能保存丢失");
  expect(screen.getByRole("listitem")).toHaveTextContent("中文列表");
  screen.getByRole("button", { name: "标题" }).focus();
  await userEvent.keyboard("{Enter}");
  expect(onPost).toHaveBeenCalledWith("post");
  screen.getByRole("button", { name: "连接博文：标题" }).focus();
  await userEvent.keyboard(" ");
  expect(onSelect).toHaveBeenCalledWith("element");
  view.rerender(<WorkCanvas {...props} selected="other" />);
  await userEvent.click(screen.getByRole("button", { name: "标题" }));
  expect(onPost).toHaveBeenCalledTimes(2);
  expect(onSelect).toHaveBeenCalledTimes(1);
  screen.getByRole("button", { name: "Edit" }).focus();
  await userEvent.keyboard("{Enter}");
  expect(onPost).toHaveBeenCalledTimes(3);
  expect(onSelect).toHaveBeenCalledTimes(1);
  view.rerender(<WorkCanvas {...props} disabled />);
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
  expect(onPost).toHaveBeenCalledTimes(3);
  view.rerender(<WorkCanvas {...props} work={{ ...work, canManage: false }} />);
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  view.rerender(<WorkCanvas {...props} work={{ ...work, status: "published" }} />);
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(onPost).toHaveBeenCalledTimes(4);
  view.rerender(<WorkCanvas {...props} work={{ ...work, status: "published", canManage: false }} />);
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  view.rerender(<WorkCanvas {...props} editing={false} work={{ ...work, status: "published" }} />);
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  view.rerender(<WorkCanvas {...props} editing={false} work={{ ...work, posts: [{ ...work.posts[0], title: "", content: "" }] }} />);
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "未命名博文" })).toBeEnabled();
  expect(screen.queryByText("写下此刻的心情…")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "连接博文：标题" })).not.toBeInTheDocument();
  expect(work.posts[0].content).toBe(content);
});

it("普通博文仅由所有权开启作者操作，缺失快照时区用 UTC", () => {
  const post = { id: "post", slug: "test", title: "标题", content, publishedAt: "2026-10-01T00:00:00Z", author: { id: "owner", displayName: "作者", avatarLabel: "作", profile: { timezone: "Asia/Tokyo", city: "Tokyo", country: "Japan" } } };
  const view = render(<PostCard post={post} isOwner={false} />);
  const card = screen.getByRole("article");
  expect(within(card).getByRole("link", { name: "标题" })).toHaveAttribute("href", "/posts/test");
  expect(card).toHaveTextContent("10/01/2026, 00:00");
  expect(card).toHaveTextContent("Tokyo, Japan");
  expect(within(card).queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  view.rerender(<PostCard post={post} isOwner />);
  expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/posts/edit/test");
});

it("连线键盘删除保留禁用语义，纯展示连线没有额外命中区", async () => {
  const onDelete = vi.fn();
  const props = { from: { x: 10, y: 20 }, to: { x: 100, y: 200 } };
  const view = render(<svg><CanvasConnection {...props} deleteAction={{ label: "删除连线 1", disabled: false, onDelete }} /></svg>);
  screen.getByRole("button", { name: "删除连线 1" }).focus();
  await userEvent.keyboard("{Enter} ");
  expect(onDelete).toHaveBeenCalledTimes(2);
  view.rerender(<svg><CanvasConnection {...props} deleteAction={{ label: "删除连线 1", disabled: true, onDelete }} /></svg>);
  await userEvent.keyboard("{Enter} ");
  expect(onDelete).toHaveBeenCalledTimes(2);
  view.rerender(<svg><CanvasConnection {...props} /></svg>);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
