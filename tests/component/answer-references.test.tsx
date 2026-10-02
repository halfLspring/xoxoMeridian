import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AnswerReferences } from "@/components/chat/AnswerReferences";
import type { AnswerReferences as References } from "@/lib/answer-references";

const content = "展览十点开门。\n\n可步行前往。";
const references: References = {
  version: 1, sources: [{ id: "s1", title: "展馆公告", url: "https://museum.test/notice", dates: [{ kind: "published", value: "2026-09-20" }] }],
  citations: [{ start: 0, end: 7, sourceIds: ["s1"] }],
};
describe("参考来源折叠展示", () => {
  it("默认折叠，展开后提供安全链接、原始日期和对应结论", async () => {
    const user = userEvent.setup();
    render(<AnswerReferences content={content} references={references} />);
    const summary = screen.getByText("参考来源（1）");
    expect(screen.getByText("展馆公告")).not.toBeVisible();
    await user.click(summary);
    const link = screen.getByRole("link", { name: "展馆公告（新窗口打开）" });
    expect(link).toBeVisible();
    expect(link).toHaveAttribute("href", "https://museum.test/notice");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("发布/更新：2026-09-20")).toBeVisible();
    expect(screen.getByRole("list", { name: "“展馆公告”对应的内容" })).toHaveTextContent("展览十点开门。");
    expect(screen.queryByText("可步行前往。")).toBeNull();
    await user.click(summary);
    expect(link).not.toBeVisible();
  });
  it("无来源和历史文本不出现空入口", () => {
    render(<AnswerReferences content="历史答复" />);
    expect(screen.queryByText(/参考来源/)).toBeNull();
  });
});
