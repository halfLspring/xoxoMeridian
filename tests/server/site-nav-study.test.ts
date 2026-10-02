import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mockNavigation = vi.hoisted(() => ({
  pathname: "/study",
}));

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => mockNavigation.pathname),
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

import { SiteNav } from "@/components/blog/SiteNav";

describe("SiteNav study link", () => {
  it("renders Study link and highlights it on /study", () => {
    const html = renderToStaticMarkup(
      React.createElement(SiteNav, {
        displayName: "Alice",
      })
    );

    expect(html).toContain(">Study<");
    expect(html).toContain(">Alice<");
    expect(html).toContain('href="/study"');
  });

  it("uses the same full-width split layout as the chat header", () => {
    mockNavigation.pathname = "/home";

    const html = renderToStaticMarkup(
      React.createElement(SiteNav, {
        displayName: "Alice",
      })
    );

    expect(html).toContain('>My Draft<');
    expect(html).toContain('>Blog<');
    expect(html).not.toContain("max-w-3xl");
  });

  it("Study 页继续隐藏 New Post 入口", () => {
    mockNavigation.pathname = "/study";

    const html = renderToStaticMarkup(
      React.createElement(SiteNav, {
        displayName: "Alice",
      })
    );

    expect(html).not.toContain(">New Post<");
    expect(html).not.toContain('href="/posts/new"');
  });

  it("Blog 页恢复 New Post 和原发文链接，保留 My Draft", () => {
    mockNavigation.pathname = "/home";

    const html = renderToStaticMarkup(
      React.createElement(SiteNav, {
        displayName: "Alice",
      })
    );

    expect(html).toContain(">New Post<");
    expect(html).not.toContain(">New Draft<");
    expect(html).toContain('href="/posts/new"');
    expect(html).toContain('>My Draft<');
    expect(html).not.toContain('href="/home?draft=new"');
  });
});
