/** 离线结构复核与度量，不将字数或链接数量作为语义正确性的证明。 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseAnswerResponse, validateAnswerText } from "@/agent/answer-evidence";
import { parsePlannerResponse } from "@/agent/plan-contract";
import { createToolRegistry } from "@/agent/tool-registry";
import { answerCases } from "@/tests/evals/agent-answer/cases";
import { validationCases } from "@/tests/evals/agent-answer/validation-cases";

type Sample = { id: string; phase: string; repeat: number; content: string | null; error: string | null; inputChars: number; durationMs: number };
const directory = resolve(process.argv[2] ?? "docs/plan/evidence/feat-108");
const registry = createToolRegistry();
const reports = [];
for (const variant of ["legacy", "concise-v1", "minimal-v1", "concise-v2", "concise-v3", "concise-final", "validation"]) {
  const rows = JSON.parse(await readFile(resolve(directory, `${variant}.json`), "utf8")) as Sample[];
  const samples = rows.map((row) => {
    let text = "";
    let failure: string | null = row.error;
    let sourceCount = 0;
    try {
      if (!row.content) throw new Error("缺少模型正文");
      if (row.phase === "planning") {
        text = parsePlannerResponse(row.content, registry, registry.list().map((tool) => tool.name)).finalResponseText;
      } else {
        const fixture = [...answerCases, ...validationCases].find((item) => item.id === row.id)!;
        if (variant === "legacy") text = validateAnswerText(JSON.parse(row.content).text, fixture.request);
        else {
          const answer = parseAnswerResponse(row.content, fixture.request);
          text = answer.text;
          sourceCount = answer.references?.sources.length ?? 0;
        }
      }
    } catch (cause) { failure = cause instanceof Error ? cause.message : "结构失败"; }
    return { id: row.id, phase: row.phase, repeat: row.repeat, failure, bodyChars: text.length,
      bodyUrls: (text.match(/https?:\/\//gu) ?? []).length, sourceCount, inputChars: row.inputChars, durationMs: row.durationMs };
  });
  const average = (values: number[]) => Math.round(values.reduce((sum, item) => sum + item, 0) / values.length);
  const synthesis = samples.filter((row) => row.phase === "synthesis" && !row.failure);
  const planning = samples.filter((row) => row.phase === "planning");
  reports.push({ variant, total: samples.length, structurePassed: samples.filter((item) => !item.failure).length,
    synthesisBodyChars: average(synthesis.map((row) => row.bodyChars)), synthesisBodyUrls: synthesis.reduce((sum, row) => sum + row.bodyUrls, 0),
    synthesisInputChars: average(synthesis.map((row) => row.inputChars)), planningInputChars: planning.length ? average(planning.map((row) => row.inputChars)) : null,
    durationMs: average(samples.map((row) => row.durationMs)), samples });
}
await writeFile(resolve(directory, "metrics.json"), JSON.stringify(reports, null, 2) + "\n");
console.log(JSON.stringify(reports.map(({ samples: _samples, ...report }) => report), null, 2));
