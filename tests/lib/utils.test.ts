import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("界面工具类合并", () => {
  it("条件类和自定义配色保留，后传入的 v4 阴影及焦点样式生效", () => {
    expect(cn("text-sage-700 text-sm shadow-xs focus:outline-hidden", [false, "text-lg"], {
      "shadow-lg": true, "bg-red-50": false,
    }, "focus:outline-none")).toBe("text-sage-700 text-lg shadow-lg focus:outline-none");
  });

  it("字号、字体、颜色与正文行高互不误删", () => {
    expect(cn("font-mono text-sm text-black/60 leading-snug", "prose prose-sm"))
      .toBe("font-mono text-sm text-black/60 leading-snug prose prose-sm");
    expect(cn("rounded-xs", "rounded-sm", "bg-linear-to-r/srgb", "bg-linear-to-b/srgb"))
      .toBe("rounded-sm bg-linear-to-b/srgb");
  });
});
