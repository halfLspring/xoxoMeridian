import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreatePost, mockUpdatePost, mockDeletePost, mockPush, mockBack } = vi.hoisted(() => ({
  mockCreatePost: vi.fn(),
  mockUpdatePost: vi.fn(),
  mockDeletePost: vi.fn(),
  mockPush: vi.fn(),
  mockBack: vi.fn(),
}));

vi.mock("@/app/actions/posts", () => ({
  createPost: mockCreatePost,
  updatePost: mockUpdatePost,
  deletePost: mockDeletePost,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

import { PostEditor } from "@/components/blog/PostEditor";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PostEditor", () => {
  it("does not submit again while the create action is pending", async () => {
    let resolveCreate: (value: { post: { id: string; slug: string; title: string } }) => void;
    mockCreatePost.mockImplementation(
      () => new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );
    const user = userEvent.setup();

    render(
      <PostEditor />
    );
    await user.type(screen.getByLabelText("Post title"), "My Post");
    await user.type(screen.getByLabelText("Post content"), "Body");

    const submit = screen.getByRole("button", { name: "Publish" });
    await user.click(submit);
    await user.click(submit);

    expect(mockCreatePost).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();

    resolveCreate!({ post: { id: "post-1", slug: "my-post", title: "My Post" } });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/posts/my-post");
    });
  });

  it("无需用户对象也显示发布错误并允许重试", async () => {
    mockCreatePost.mockResolvedValueOnce({ error: "Content is required" })
      .mockResolvedValueOnce({ post: { id: "post-1", slug: "my-post", title: "My Post" } });
    const user = userEvent.setup();
    render(<PostEditor />);
    await user.type(screen.getByLabelText("Post title"), "My Post");
    await user.type(screen.getByLabelText("Post content"), "Body");
    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Content is required")).toBeVisible();
    expect(mockPush).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/posts/my-post"));
    expect(mockCreatePost).toHaveBeenLastCalledWith("My Post", "Body");
    expect(screen.queryByText("Content is required")).not.toBeInTheDocument();
  });

  it("只凭初始文章内容编辑，保存期间禁用控件且按原 slug 更新", async () => {
    let finish!: (value: { post: { id: string; slug: string; title: string } }) => void;
    mockUpdatePost.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    render(<PostEditor initialValues={{ slug: "original", title: "原题", content: "原文" }} />);
    await user.clear(screen.getByLabelText("Post content"));
    await user.type(screen.getByLabelText("Post content"), "新正文");
    await user.click(screen.getByRole("button", { name: "Update" }));
    expect(mockUpdatePost).toHaveBeenCalledExactlyOnceWith("original", "原题", "新正文");
    expect(screen.getByLabelText("Post title")).toBeDisabled();
    expect(screen.getByLabelText("Post content")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    finish({ post: { id: "post-1", slug: "original", title: "原题" } });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/posts/original"));
  });

  it("键盘可取消新建且不提交任何写入", async () => {
    const user = userEvent.setup();
    render(<PostEditor />);
    for (let index = 0; index < 4; index++) await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(mockBack).toHaveBeenCalledOnce();
    expect(mockCreatePost).not.toHaveBeenCalled();
    expect(mockUpdatePost).not.toHaveBeenCalled();
    expect(mockDeletePost).not.toHaveBeenCalled();
  });

  it("删除先确认，可取消，确认后的等待期间不会重复写入", async () => {
    let finish!: (value: { deleted: true }) => void;
    mockDeletePost.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    render(<PostEditor initialValues={{ slug: "original", title: "原题", content: "原文" }} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Are you sure you want to delete this post?")).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "Cancel" })[1]);
    expect(mockDeletePost).not.toHaveBeenCalled();
    expect(screen.queryByText("Are you sure you want to delete this post?")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = screen.getAllByRole("button", { name: "Delete" })[1];
    await user.click(confirm);
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    expect(mockDeletePost).toHaveBeenCalledExactlyOnceWith("original");
    finish({ deleted: true });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/home"));
  });
});
