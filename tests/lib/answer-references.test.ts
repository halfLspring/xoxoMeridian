import { describe, expect, it } from "vitest";
import { readAnswerReferences, safeSourceUrl } from "@/lib/answer-references";
const content = "展览十点开门。";
const references = {
  version: 1, sources: [{ id: "s1", title: "展馆", url: "https://museum.test/", dates: [] }],
  citations: [{ start: 0, end: content.length, sourceIds: ["s1"] }],
};
describe("来源最小投影", () => {
  it("仅投影通过校验的来源，不泄漏工具载荷", () => {
    const projected = readAnswerReferences({ answerReferences: references, toolResults: "private-payload" }, content);
    expect(projected).toEqual(references);
    expect(JSON.stringify(projected)).not.toContain("private-payload");
    expect(readAnswerReferences(null, content)).toBeUndefined();
    expect(readAnswerReferences({ toolResults: [] }, content)).toBeUndefined();
  });
  it.each([
    { ...references, version: 2 },
    { ...references, sources: [{ ...references.sources[0], url: "javascript:alert(1)" }] },
    { ...references, citations: [{ start: 0, end: 999, sourceIds: ["s1"] }] },
    { ...references, citations: [{ start: 2, end: 1, sourceIds: ["s1"] }] },
    { ...references, citations: [{ start: 0, end: 1, sourceIds: ["s2"] }] },
    { ...references, sources: [...references.sources, { ...references.sources[0], id: "s2" }] },
  ])("坏版本/不安全URL/损坏关联保留正文并隐藏来源入口", (value) => {
    expect(readAnswerReferences({ answerReferences: value }, content)).toBeUndefined();
  });
  it("拒绝非网页协议和带凭据的来源", () => {
    for (const url of ["javascript:alert(1)", "file:///tmp/a", "https://secret:password@host.test", "//host.test"]) expect(safeSourceUrl(url)).toBeNull();
    expect(safeSourceUrl("https://host.test")).toBe("https://host.test/");
  });
});
