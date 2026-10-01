import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MessageList } from "@/components/chat/MessageList";
import { LifePanel } from "@/components/chat/LifePanel";
import type { ChatMessage } from "@/components/chat/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const createdAt = "2026-09-30T23:30:00.000Z";
const message: ChatMessage = {
  id: "message-1", roomId: "room-1", senderType: "system", content: "时间回归",
  targetType: "all", status: "sent", createdAt,
};

describe("聊天与计划时间", () => {
  it.each([
    ["Asia/Tokyo", "08:30"],
    [null, "23:30"],
  ])("聊天使用当前用户时区 %s，缺失时回退 UTC", (timezone, expected) => {
    const html = renderToStaticMarkup(createElement(MessageList, {
      messages: [message],
      currentUser: {
        id: "viewer", displayName: "用户", avatarLabel: "U",
        profile: timezone ? { city: "Tokyo", country: "Japan", timezone } : null,
      },
    }));
    expect(html).toContain(expected);
  });

  it.each([
    ["Asia/Tokyo", "10月1日 08:30"],
    ["", "9月30日 23:30"],
  ])("计划使用任务时区 %s，缺失时回退 UTC", (timezone, expected) => {
    const html = renderToStaticMarkup(createElement(LifePanel, {
      currentUserId: "viewer", roomId: "room-1", participants: [], memos: [],
      scheduledJobs: [{ id: "job-1", cron: "30 23 * * *", timezone, nextRunAt: createdAt }],
    }));
    expect(html).toContain(expected);
  });
});
