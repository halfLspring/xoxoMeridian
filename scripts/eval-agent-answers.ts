/** 手动真实模型评估：仅发送仓库中的合成案例，不读取业务数据库。 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { env } from "@/lib/env";

const [variant = "legacy", outputPath, split = "comparison"] = process.argv.slice(2);
if (!["legacy", "concise", "minimal"].includes(variant) || !outputPath) {
  throw new Error("用法：node --env-file=.env --import tsx scripts/eval-agent-answers.ts legacy|concise|minimal 输出.jsonl [comparison|development|held-out|validation|all]");
}
if (!env.LLM_API_KEY || env.LLM_PROVIDER === "mock") throw new Error("真实模型评估需要已配置的非 mock LLM。");
const legacy = JSON.parse(await readFile(resolve("tests/evals/agent-answer/legacy-requests.json"), "utf8")) as {
  system: Record<string, { role: string; content: string }>; availableTools: unknown[];
  cases: Array<{ id: string; phase: string; split: string; criteria: string; input: Record<string, unknown> }>;
};
const output = resolve(outputPath);
await mkdir(dirname(output), { recursive: true });
// 两次独立采样，顺序固定；只有运行者显式选择版本才会产生费用。
for (let repeat = 1; repeat <= 2; repeat += 1) {
  for (const fixture of legacy.cases.filter((item) => split === "all" || (split === "comparison" ? item.split !== "validation" : item.split === split))) {
    const started = Date.now();
    const messages = variant === "legacy" ? [legacy.system[fixture.phase], {
      role: "user", content: JSON.stringify({ ...fixture.input, ...(fixture.phase === "planning" ? { available_tools: legacy.availableTools } : {}) })
    }] : await candidateMessages(variant, fixture.phase, fixture.id);
    let content: string | null = null;
    let error: string | null = null;
    let usage: unknown = null;
    try {
      const response = await fetch(`${env.LLM_BASE_URL.replace(/\/$/u, "")}/chat/completions`, {
        method: "POST", headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(env.LLM_TIMEOUT_MS),
        body: JSON.stringify({ model: env.LLM_MODEL, temperature: 0.2, max_completion_tokens: env.AGENT_LLM_MAX_COMPLETION_TOKENS, response_format: { type: "json_object" }, messages })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      content = data.choices?.[0]?.message?.content ?? null;
      usage = data.usage ?? null;
      if (!content) throw new Error("模型未返回正文");
    } catch (cause) { error = cause instanceof Error ? cause.message : "未知请求错误"; }
    const record = { variant, id: fixture.id, phase: fixture.phase, split: fixture.split, criteria: fixture.criteria, repeat,
      provider: env.LLM_PROVIDER, model: env.LLM_MODEL, host: new URL(env.LLM_BASE_URL).host, temperature: 0.2,
      maxCompletionTokens: env.AGENT_LLM_MAX_COMPLETION_TOKENS, timeoutMs: env.LLM_TIMEOUT_MS,
      promptHash: createHash("sha256").update(JSON.stringify(messages)).digest("hex"),
      messages, inputChars: JSON.stringify(messages).length, durationMs: Date.now() - started, content, error, usage };
    await appendFile(output, JSON.stringify(record) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ variant, id: fixture.id, phase: fixture.phase, repeat, error, durationMs: record.durationMs }));
  }
}

async function candidateMessages(variant: string, phase: string, id: string) {
  // 通过实际 Provider 捕获出站请求，确保评估与产品提示词/有效工具 schema 一致。
  const { createLLMProvider } = await import("@/agent/llm-provider");
  const { createToolRegistry } = await import("@/agent/tool-registry");
  const { answerCases, planCases } = await import("@/tests/evals/agent-answer/cases");
  const { validationCases } = await import("@/tests/evals/agent-answer/validation-cases");
  const registry = createToolRegistry();
  const provider = createLLMProvider(registry);
  const fetchOriginal = globalThis.fetch;
  let messages: Array<{ role: string; content: string }> | undefined;
  globalThis.fetch = async (_input, init) => {
    messages = JSON.parse(init!.body as string).messages;
    return Response.json({ choices: [{ message: { content: "{}" } }] });
  };
  try {
    if (phase === "synthesis") await provider.synthesize!({ ...[...answerCases, ...validationCases].find((item) => item.id === id)!.request, maxCompletionTokens: env.AGENT_LLM_MAX_COMPLETION_TOKENS });
    else await provider.plan({ ...planCases.find((item) => item.id === id)!.request, availableTools: registry.list().map(({ name, description, schema }) => ({ name, description, schema })) });
  } catch { /* 无需解析占位响应。 */ } finally { globalThis.fetch = fetchOriginal; }
  if (!messages) throw new Error("缺少候选出站请求");
  if (variant === "minimal") {
    const { EVIDENCE_GUIDANCE } = await import("@/agent/prompts");
    messages = messages.map((message) => message.role === "system" ? { ...message, content: message.content.replace(EVIDENCE_GUIDANCE, "") } : message);
  }
  return messages;
}
