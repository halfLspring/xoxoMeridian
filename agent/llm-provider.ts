import { buildAnswerEvidence, buildEvidenceFallback, parseAnswerResponse } from "@/agent/answer-evidence";
import { parsePlannerResponse } from "@/agent/plan-contract";
import { planningPrompt, synthesisPrompt } from "@/agent/prompts";
import { createToolRegistry, type ToolRegistry } from "@/agent/tool-registry";
import type { AgentPlan, LLMAnswerRequest, LLMAnswerResult, LLMPlanRequest, LLMPlanResult, LLMProvider } from "@/agent/types";
import { env } from "@/lib/env";
import { AGENT_DISPLAY_NAME, MENTION_AGENT } from "@/lib/identity";

type OpenAICompatibleResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export function createLLMProvider(registry = createToolRegistry()): LLMProvider {
  if (env.LLM_PROVIDER === "mock" || !env.LLM_API_KEY) {
    return createMockLLMProvider();
  }

  return createOpenAICompatibleProvider({
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    timeoutMs: env.LLM_TIMEOUT_MS
  }, registry);
}

export function createMockLLMProvider(): LLMProvider {
  return {
    name: "mock-local-planner",
    model: "mock-structured-planner",
    async plan(request: LLMPlanRequest): Promise<LLMPlanResult> {
      const prompt = request.prompt.trim();
      const lowerPrompt = prompt.toLowerCase();
      const hasWeather = prompt.includes("天气") || lowerPrompt.includes("weather");
      const hasTimezone = prompt.includes("时差") || prompt.includes("时间") || lowerPrompt.includes("timezone");
      const hasMemo = prompt.includes("备忘") || lowerPrompt.includes("memo");
      const hasTyphoon = prompt.includes("台风") || lowerPrompt.includes("typhoon");
      const hasSearch = hasTyphoon || prompt.includes("搜索") || prompt.includes("查一下") || prompt.includes("有什么") ||
                        lowerPrompt.includes("search") || lowerPrompt.includes("find");

      if (hasWeather) {
        const partnerCity = request.roomContext.partner?.city?.trim();
        return withRaw({
          intent: "get_weather",
          confidence: 0.82,
          requiredTools: hasTyphoon ? ["weather.get", "web.search"] : ["weather.get"],
          taskSteps: ["读取对方城市", "查询天气", "回复聊天室"],
          finalResponsePlan: "用简短温暖的方式说明对方城市天气。",
          finalResponseText: "我已经查到天气了，会在房间里温柔地告诉你具体情况。",
          toolInputs: {
            "weather.get": partnerCity ? { city: partnerCity } : {},
            ...(hasTyphoon ? { "web.search": { query: prompt, maxResults: 5, topic: "news", timeRange: "week" } } : {})
          }
        });
      }

      if (hasTimezone) {
        const { self, partner } = request.roomContext;
        const timezoneInput = self && partner
          ? {
              fromLabel: self.displayName,
              ...(self.timezone ? { fromTimezone: self.timezone } : {}),
              toLabel: partner.displayName,
              ...(partner.timezone ? { toTimezone: partner.timezone } : {})
            }
          : {};
        return withRaw({
          intent: "compare_timezone",
          confidence: 0.84,
          requiredTools: ["timezone.compare"],
          taskSteps: ["读取双方时区", "计算当前时间", "说明适合联系窗口"],
          finalResponsePlan: "告诉用户两地当前时间和联系建议。",
          finalResponseText: "我已经把双方所在时区的当前时间整理好了。",
          toolInputs: {
            "timezone.compare": timezoneInput
          }
        });
      }

      if (hasMemo) {
        return withRaw({
          intent: "create_memo",
          confidence: 0.78,
          requiredTools: ["memo.create"],
          taskSteps: ["整理备忘录标题", "写入备忘录", "回复聊天室"],
          finalResponsePlan: "告诉用户备忘录已经保存。",
          finalResponseText: "备忘录已经记下了。",
          toolInputs: {
            "memo.create": {
              title: "新的备忘录",
              content: prompt.replace(/^(帮我)?(创建|新增)?备忘录[:：\s]*/u, "") || prompt
            }
          }
        });
      }

      if (hasSearch) {
        return withRaw({
          intent: "web_search",
          confidence: 0.75,
          requiredTools: ["web.search"],
          taskSteps: ["提取搜索关键词", "调用搜索 API", "整理结果回复"],
          finalResponsePlan: "用自然语言呈现搜索结果。",
          finalResponseText: "我帮你搜索了相关信息。",
          toolInputs: {
            "web.search": {
              query: prompt.replace(/^(帮我)?(搜索|查一下|找一下)[:：\s]*/u, "") || prompt,
              maxResults: 5
            }
          }
        });
      }

      return withRaw({
        intent: "chat_assist",
        confidence: 0.5,
        requiredTools: [],
        taskSteps: ["直接回复用户"],
        finalResponsePlan: "直接回答用户的问题。",
        finalResponseText: `我是这个房间的${AGENT_DISPLAY_NAME}，可以帮你查天气、对时区、搜索信息、写备忘和设任务。`,
        toolInputs: {}
      });
    },
    async synthesize(request: LLMAnswerRequest): Promise<LLMAnswerResult> {
      request.signal?.throwIfAborted();
      return buildEvidenceFallback(request);
    }
  };
}

function withRaw(plan: AgentPlan): LLMPlanResult {
  return {
    ...plan,
    rawResponse: {
      intent: plan.intent,
      confidence: plan.confidence,
      required_tools: plan.requiredTools,
      task_steps: plan.taskSteps,
      final_response_plan: plan.finalResponsePlan,
      final_response_text: plan.finalResponseText,
      tool_inputs: plan.toolInputs
    }
  };
}

function createOpenAICompatibleProvider(config: {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
}, registry: ToolRegistry): LLMProvider {
  return {
    name: "openai-compatible",
    model: config.model,
    async plan(request: LLMPlanRequest): Promise<LLMPlanResult> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      const forwardAbort = () => controller.abort(request.signal?.reason);
      if (request.signal?.aborted) {
        forwardAbort();
      } else {
        request.signal?.addEventListener("abort", forwardAbort, { once: true });
      }

      try {
        const response = await fetch(`${config.baseURL.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json"
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: config.model,
            temperature: 0.2,
            max_completion_tokens: request.maxCompletionTokens,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: planningPrompt(request)
              },
              {
                role: "user",
                content: JSON.stringify({
                  user_prompt: request.prompt,
                  reference_time: request.referenceTime,
                  room_context: request.roomContext,
                  available_tools: request.availableTools,
                  validation_feedback: request.validationFeedback
                    ? {
                        note: "上一轮的 plan 存在以下不一致，请根据反馈重新生成 plan，注意修正 tool_inputs 与 final_response_text 的一致性：",
                        previous_plan: request.validationFeedback.previousPlan,
                        issues: request.validationFeedback.issues
                      }
                    : undefined,
                  required_shape: {
                    intent: "string",
                    confidence: "number between 0 and 1",
                    required_tools: "string[] (must be subset of available_tools[].name, empty if user just chats)",
                    task_steps: "string[] (internal plan, dev-facing)",
                    final_response_plan: "string (internal plan summary, dev-facing)",
                    final_response_text: "string (Chinese reply for zero-tool chat; otherwise only a pre-execution draft without invented results)",
                    tool_inputs: "object keyed by tool name; each value's fields MUST match that tool's schema.properties exactly"
                  }
                })
              }
            ]
          })
        });

        if (!response.ok) {
          throw new Error(`LLM request failed with ${response.status}: ${await response.text()}`);
        }

        const payload = (await response.json()) as OpenAICompatibleResponse;
        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error("LLM response did not contain message content.");
        }

        return {
          ...parsePlannerResponse(content, registry, request.availableTools.map((tool) => tool.name)),
          rawResponse: payload,
          usage: {
            promptTokens: payload.usage?.prompt_tokens,
            completionTokens: payload.usage?.completion_tokens,
            totalTokens: payload.usage?.total_tokens
          }
        };
      } catch (error) {
        if (request.signal?.aborted && request.signal.reason !== undefined) {
          throw request.signal.reason;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", forwardAbort);
      }
    },
    async synthesize(request: LLMAnswerRequest): Promise<LLMAnswerResult> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      const forwardAbort = () => controller.abort(request.signal?.reason);
      if (request.signal?.aborted) forwardAbort();
      else request.signal?.addEventListener("abort", forwardAbort, { once: true });
      try {
        controller.signal.throwIfAborted();
        const response = await fetch(`${config.baseURL.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model: config.model,
            temperature: 0.2,
            max_completion_tokens: request.maxCompletionTokens,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: synthesisPrompt(request)
              },
              {
                role: "user",
                content: JSON.stringify({
                  user_prompt: request.prompt,
                  reference_time: request.referenceTime,
                  room_context: {
                    room: request.roomContext.room,
                    self: answerParticipant(request.roomContext.self),
                    partner: answerParticipant(request.roomContext.partner),
                    recentMessages: request.roomContext.recentMessages.slice(-6).map((message) => ({ ...message, content: message.content.slice(0, 2_000) }))
                  },
                  task_intent: request.plan.intent,
                  evidence: buildAnswerEvidence(request),
                  required_shape: { blocks: [{ text: "string", sourceIds: "string[] from evidence.sources; only sources used for this block" }] }
                })
              }
            ]
          })
        });
        if (!response.ok) throw new Error(`LLM synthesis request failed with ${response.status}.`);
        const payload = await response.json() as OpenAICompatibleResponse;
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== "string") throw new Error("LLM synthesis response did not contain message content.");
        return {
          ...parseAnswerResponse(content, request),
          rawResponse: payload,
          usage: {
            promptTokens: payload.usage?.prompt_tokens,
            completionTokens: payload.usage?.completion_tokens,
            totalTokens: payload.usage?.total_tokens
          }
        };
      } catch (error) {
        if (request.signal?.aborted && request.signal.reason !== undefined) throw request.signal.reason;
        throw error;
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", forwardAbort);
      }
    }
  };
}

function answerParticipant(participant: LLMAnswerRequest["roomContext"]["self"]) {
  return participant ? { displayName: participant.displayName, city: participant.city, timezone: participant.timezone } : null;
}
