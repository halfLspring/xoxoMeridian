import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DraftSelectionOverlay } from "@/components/blog-work/DraftSelectionOverlay";
import type { CreateWorkInput } from "@/lib/blog-work/schemas";
function renderOverlay(overrides: Partial<{ onCreate: (input: CreateWorkInput) => void; onCancel: () => void; error: string; pending: boolean }> = {}) {
  const inputs: CreateWorkInput[] = [], onCreate = vi.fn((input: CreateWorkInput) => { inputs.push(input); }), onCancel = vi.fn();
  const rendered = render(<DraftSelectionOverlay onCreate={overrides.onCreate ?? onCreate} onCancel={overrides.onCancel ?? onCancel} error={overrides.error ?? ""} pending={overrides.pending ?? false} />);
  return { ...rendered, inputs, onCreate, onCancel };
}
describe("草稿框选浮层", () => {
  it("进入框选模式不显示说明与操作卡片，只有创建失败才显现恢复入口", () => {
    const { rerender } = renderOverlay();
    const help = screen.getByRole("group", { name: "框选草稿区域" });
    expect(help).not.toHaveAttribute("data-revealed"); expect(help).not.toHaveTextContent("拖动框选");
    rerender(<DraftSelectionOverlay onCreate={vi.fn()} onCancel={vi.fn()} error="创建失败，请重试" pending={false} />);
    expect(help).toHaveAttribute("data-revealed");
  });
  it("默认区域给出建议窗口，恢复重试沿用同一幂等键", async () => {
    const { rerender, inputs } = renderOverlay();
    await userEvent.click(screen.getByRole("button", { name: "使用默认区域" }));
    expect(inputs).toHaveLength(1); expect(inputs[0]).toMatchObject({ draftX: 24, viewportWidth: 960, viewportHeight: 540 });
    expect(inputs[0].mutationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    rerender(<DraftSelectionOverlay onCreate={vi.fn((input: CreateWorkInput) => { inputs.push(input); })} onCancel={vi.fn()} error="创建失败，请重试" pending={false} />);
    await userEvent.click(screen.getByRole("button", { name: "重试创建" }));
    expect(inputs).toHaveLength(2); expect(inputs[1]).toEqual(inputs[0]);
  });
  it("未失败时不提供重试，取消按钮与 Escape 都不创建草稿", async () => {
    const { onCreate, onCancel } = renderOverlay();
    expect(screen.queryByRole("button", { name: "重试创建" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "取消框选" })); expect(onCancel).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}"); expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onCreate).not.toHaveBeenCalled();
  });
  it("创建中禁用操作按钮，不能重复提交", async () => {
    const { onCreate } = renderOverlay({ pending: true });
    for (const name of ["使用默认区域", "取消框选"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "使用默认区域" }));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
