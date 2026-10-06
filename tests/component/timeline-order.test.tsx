import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Timeline, type TimelinePost } from "@/components/blog/Timeline";
import type { WorkSnapshot } from "@/lib/blog-work/types";

const publishedAt = "2026-09-13T01:02:03.123Z";

function post(id: string, overrides: Partial<TimelinePost> = {}): TimelinePost {
  return {
    id, slug: id, title: id, content: "共同记录", type: "user_post", authorId: "author-a",
    author: { id: "author-a", displayName: "甲", avatarLabel: "甲" }, publishedAt, ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

describe("Timeline 稳定时间顺序", () => {
  it("同时间普通文章按 ID 升序显示，混入日志与重新渲染不改变可见顺序", () => {
    const posts = [
      post("cpostc"),
      post("cposta", { publishedAt: new Date(publishedAt), authorId: "author-b" }),
      post("cpostb", { type: "agent_log", authorId: null, author: null }),
      post("cpostolder", { publishedAt: "2026-09-13T01:02:03.122Z" }),
      post("cpostnewer", { publishedAt: "2026-09-13T01:02:03.124Z" }),
    ];
    const originalIds = posts.map(({ id }) => id);
    const { rerender } = render(<Timeline posts={posts} currentUserId="author-a" />);
    const displayedTitles = () => screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    const expected = ["cpostolder", "cposta", "cpostc", "cpostnewer"];
    expect(displayedTitles()).toEqual(expected);
    rerender(<Timeline posts={[...posts].reverse()} currentUserId="author-a" />);
    expect(displayedTitles()).toEqual(expected);
    rerender(<Timeline posts={[posts[2], posts[0], posts[4], posts[1], posts[3]]} currentUserId="author-a" />);
    expect(displayedTitles()).toEqual(expected);
    expect(posts.map(({ id }) => id)).toEqual(originalIds);
  });

  const logs = ["新日志", "旧日志", "伙伴日志", "失联日志", "无发起者日志"].map((title, index) => post(`log-${index}`, {
    title, content: `日志载荷 ${index}`, type: "agent_log", authorId: null, author: null,
    agentRequesterId: index < 3 ? `author-${index}` : null,
    metadata: index === 3 ? { taskId: "missing-task" } : { taskId: `task-${index}` },
  }));

  it("混合内容只渲染普通文章与空间作品，日志不留下卡片、节点或可访问内容", () => {
    const work: WorkSnapshot = {
      id: "work", ownerId: "author-a", ownerName: "甲", status: "published", revision: 1,
      viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540, layoutWidth: 960,
      publishedAt, updatedAt: publishedAt, canManage: true, posts: [], elements: [], connections: [],
    };
    const { container } = render(<Timeline
      posts={[...logs, post("普通文章", { content: "weather.get 与 agent.log 的使用记录" })]}
      works={[work]}
      renderWork={() => <article aria-label="空间作品">已发布作品</article>}
      currentUserId="author-a"
    />);
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "普通文章" })).toBeInTheDocument();
    expect(screen.getByText("weather.get 与 agent.log 的使用记录")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "空间作品" })).toBeInTheDocument();
    // 时间轴圆点也是可见输出：隐藏日志不得留下没有内容的节点或空白行。
    expect(container.querySelectorAll(".timeline-dot")).toHaveLength(1);
    expect(container.querySelector(".timeline-line")?.nextElementSibling?.children).toHaveLength(2);
    for (const log of logs) {
      expect(screen.queryByText(log.title)).not.toBeInTheDocument();
      expect(screen.queryByText(log.content)).not.toBeInTheDocument();
    }
  });

  it.each([undefined, "No posts match your search."])("纯日志显示正确空态（%s），不提示等待 Agent 日志", emptyMessage => {
    const { container } = render(<Timeline posts={logs} currentUserId="author-a" emptyMessage={emptyMessage} />);
    expect(screen.getByText(emptyMessage ?? "No moments yet.")).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(container.querySelector(".timeline-line")).toBeNull();
    expect(container.querySelector(".timeline-dot")).toBeNull();
    expect(container).not.toHaveTextContent(/wait for the agent|日志载荷|新日志|旧日志|伙伴日志|失联日志|无发起者日志/i);
  });
});
