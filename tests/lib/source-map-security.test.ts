import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import postcss from "postcss";
import { SourceMapConsumer } from "source-map-js";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

// 恶意映射只在限时、限堆的子进程中处理，依赖回退也不能卡住 Vitest。
function checkSourceMap(script: string) {
  execFileSync(process.execPath, [
    "--max-old-space-size=64", "--input-type=module", "-e",
    `import assert from "node:assert/strict";
     import { createRequire } from "node:module";
     const { SourceMapConsumer, SourceNode } = createRequire(import.meta.url)(process.argv[1]);
     const basic = { version: 3, sources: ["input.css"], names: [], mappings: "AAAA", sourcesContent: ["a {}"] };
     const indexed = (map, line, column = 0) => ({ version: 3, sections: [{ offset: { line, column }, map }] });
     ${script}`,
    require.resolve("source-map-js"),
  ], { timeout: 2_000, killSignal: "SIGKILL", stdio: "pipe" });
}

describe("source map 依赖安全与产物兼容", () => {
  it("拒绝会放大输出的 section 行偏移和非法行列值", () => {
    checkSourceMap(`
      for (const value of [100_000_000, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1"]) {
        assert.throws(() => new SourceMapConsumer(indexed(basic, value)));
      }
      for (const value of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1"]) {
        assert.throws(() => new SourceMapConsumer(indexed(basic, 0, value)));
      }
    `);
  });

  it("嵌套 section 累计偏移过大时在生成产物前拒绝", () => {
    checkSourceMap(`
      assert.throws(() => new SourceMapConsumer(indexed(indexed(basic, 6_000_000), 6_000_000)));
    `);
  });

  it("深层索引映射的 sources 在进程预算内返回", () => {
    checkSourceMap(`
      let map = { ...basic, sources: ["a.css", "b.css", "c.css"] };
      for (let depth = 0; depth < 30; depth++) map = indexed(map, 0);
      assert.deepEqual(new SourceMapConsumer(map).sources, ["a.css", "b.css", "c.css"]);
    `);
  });

  it("映射超出生成代码末尾时不添加虚构行或 undefined 文本", () => {
    checkSourceMap(`
      const consumer = new SourceMapConsumer(indexed(basic, 1_000));
      assert.equal(SourceNode.fromStringWithSourceMap("a {}", consumer).toString(), "a {}");
    `);
  });

  it("正常 indexed 映射能保留代码、原始位置及源码内容", () => {
    checkSourceMap(String.raw`
      const consumer = new SourceMapConsumer(indexed(basic, 1));
      const output = SourceNode.fromStringWithSourceMap("/* banner */\na {}", consumer)
        .toStringWithSourceMap({ file: "output.css" });
      const flattened = new SourceMapConsumer(output.map.toJSON());
      assert.deepEqual(flattened.originalPositionFor({ line: 2, column: 0 }),
        { source: "input.css", line: 1, column: 0, name: null });
      assert.equal(flattened.sourceContentFor("input.css"), "a {}");
      assert.equal(output.code, "/* banner */\na {}");
    `);
  });

  it("PostCSS 连续变换后仍输出正确 CSS 并映射至原始文件", async () => {
    const first = await postcss([{
      postcssPlugin: "source-map-input",
      Declaration(declaration) {
        if (declaration.prop === "color") declaration.value = "blue";
      },
    }]).process("a {\n  color: red;\n}\n", {
      from: "input.css", to: "intermediate.css", map: { inline: false, annotation: false },
    });
    const result = await postcss([{
      postcssPlugin: "source-map-compatibility",
      Declaration(declaration) {
        if (declaration.prop === "color") declaration.value = "rebeccapurple";
      },
    }]).process(first.css, {
      from: "intermediate.css", to: "output.css",
      map: { prev: first.map?.toJSON(), inline: false, annotation: false },
    });
    expect(result.css).toBe("a {\n  color: rebeccapurple;\n}\n");
    expect(result.map).toBeDefined();
    const consumer = new SourceMapConsumer(result.map!.toJSON());
    expect(consumer.originalPositionFor({ line: 2, column: 2 }))
      .toEqual({ source: "input.css", line: 2, column: 2, name: null });
    expect(consumer.sourceContentFor("input.css")).toBe("a {\n  color: red;\n}\n");
  });
});
