/** 手动评估完整规划链路：真实模型 + 合成工具适配，不执行真实写入或外部查询。 */
import { appendFile } from "node:fs/promises";
import { createLLMProvider } from "@/agent/llm-provider";
import { buildEvidenceFallback } from "@/agent/answer-evidence";
import { createToolRegistry } from "@/agent/tool-registry";
import type { ToolResult } from "@/agent/types";
import { env } from "@/lib/env";
import { answerCases, planCases } from "@/tests/evals/agent-answer/cases";

const output = process.argv[2];
if (!output || !env.LLM_API_KEY || env.LLM_PROVIDER === "mock") throw new Error("需要真实模型配置与合成评估输出路径。");
const registry = createToolRegistry();
const provider = createLLMProvider(registry);
for (let repeat = 1; repeat <= 2; repeat += 1) {
  for (const fixture of planCases) {
    let error: string | undefined;
    let result: unknown;
    try {
      const plan = await provider.plan({ ...fixture.request, availableTools: registry.list().map(({ name, description, schema }) => ({ name, description, schema })), maxCompletionTokens: env.AGENT_LLM_MAX_COMPLETION_TOKENS });
      const toolResults: ToolResult[] = [];
      for (const name of plan.requiredTools) {
        const args = Array.isArray(plan.toolInputs[name]) ? plan.toolInputs[name] as unknown[] : [plan.toolInputs[name]];
        for (const arg of args) {
          const input = registry.get(name).inputSchema.parse(arg) as Record<string, unknown>;
          let value: unknown;
          if (name === "weather.get") value = { ...answerCases.find((item) => item.id === "overview")!.request.toolResults[0].output as object, condition: "小雨", advice: "雨天带伞" };
          else if (name === "web.search") value = { provider: "tavily", query: input.query, availability: "available", results: [{ title: "旧公告", url: "https://warning.example.test/old", content: "9月12日至15日的海上预警，已结束。", publishedDate: "2026-09-12", score: 0.9 }] };
          else if (name === "schedule.list") value = { count: 0, jobs: [] };
          else if (name === "memory.recall") value = { count: 0, memories: [] };
          else if (name === "schedule.create") value = { jobId: "synthetic-job", cron: input.cron ?? "0 20 * * *", timezone: input.timezone, runOnce: Boolean(input.fireAt || input.runOnce), nextRunAt: input.fireAt ?? "2026-10-02T12:00:00Z", description: input.description ?? null };
          else if (name === "memory.set") value = { memoryId: "synthetic-memory", key: input.key, value: input.value };
          else throw new Error(`合成工作流没有实现所选工具 ${name}`);
          toolResults.push({ toolName: name, input, output: registry.validateOutput(name, value), stepKey: `tool:${toolResults.length + 1}` });
        }
      }
      const request = { ...fixture.request, referenceTime: fixture.request.referenceTime!, plan, toolResults, maxCompletionTokens: env.AGENT_LLM_MAX_COMPLETION_TOKENS };
      const needsSynthesis = plan.requiredTools.some((name) => registry.get(name).effect !== "database-write");
      const answer = !toolResults.length ? { text: plan.finalResponseText } : needsSynthesis ? await provider.synthesize!(request) : buildEvidenceFallback(request);
      result = { plan: { ...plan, rawResponse: undefined }, toolResults, answer: { ...answer, rawResponse: undefined } };
    } catch (cause) { error = cause instanceof Error ? cause.message : "评估失败"; }
    await appendFile(output, JSON.stringify({ id: fixture.id, repeat, provider: env.LLM_PROVIDER, model: env.LLM_MODEL, criteria: fixture.criteria, result, error }) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ id: fixture.id, repeat, error }));
  }
}
