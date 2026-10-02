import { searchInputSchema } from "@/agent/tool-contracts";
import type { AgentTool, ToolExecutionContext } from "@/agent/types";
import { TRANSIENT_TOOL_RETRY } from "@/agent/tool-errors";

type SearchInput = {
  query: string;
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  topic?: "general" | "news";
  timeRange?: "day" | "week" | "month" | "year";
  startDate?: string;
  endDate?: string;
  includeDomains?: string[];
};

type SearchConstraints = Omit<SearchInput, "query" | "maxResults" | "searchDepth">;

type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string | null;
};

type TavilyResponse = {
  query: string;
  answer?: string;
  results?: TavilySearchResult[];
  response_time?: number;
};

export type SearchOutput = {
  provider: "tavily" | "mock";
  query: string;
  answer?: string;
  availability: "available" | "unavailable";
  fetchedAt: string;
  constraints?: SearchConstraints;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    publishedDate: string | null;
    dateStatus: "known" | "unknown";
    dateMeaning: "published_or_updated";
    fetchedAt: string;
  }>;
  responseTime?: number;
  fallbackReason?: string;
  _meta?: {
    totalResults: number;
    displayMode?: "inline" | "card" | "collapsed";
  };
};

const FETCH_TIMEOUT_MS = 10000;
const TAVILY_API_URL = "https://api.tavily.com/search";

export async function fetchSearchResults(
  query: string,
  maxResults = 5,
  searchDepth: "basic" | "advanced" = "basic",
  signal?: AbortSignal,
  constraints: SearchConstraints = {}
): Promise<SearchOutput> {
  if (signal?.aborted) throw signal.reason ?? new Error("Search request aborted.");
  let trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("Search query is required.");
  }

  if (trimmedQuery.length > 400) {
    console.warn(`[web.search] query too long (${trimmedQuery.length} chars), truncating to 400`);
    trimmedQuery = trimmedQuery.slice(0, 400);
  }

  const {
    query: normalizedQuery,
    maxResults: normalizedMaxResults = 5,
    searchDepth: normalizedSearchDepth = "basic",
    ...normalizedConstraints
  } = searchInputSchema.parse({ query: trimmedQuery, maxResults: Math.min(maxResults, 10), searchDepth, ...constraints });
  const apiKey = process.env.TAVILY_API_KEY ?? "";

  if (!apiKey) {
    console.warn("[web.search] using mock — TAVILY_API_KEY is empty");
    return mockSearch(normalizedQuery, "TAVILY_API_KEY missing", normalizedConstraints);
  }

  try {
    return await callTavilyAPI(
      normalizedQuery,
      normalizedMaxResults,
      normalizedSearchDepth,
      apiKey,
      signal,
      normalizedConstraints
    );
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[web.search] Tavily API call failed, falling back to mock: ${reason}`);
    return mockSearch(normalizedQuery, reason, normalizedConstraints);
  }
}

export function createSearchTool(): AgentTool<SearchInput, SearchOutput> {
  return {
    name: "web.search",
    risk: "low",
    retry: TRANSIENT_TOOL_RETRY,
    description: "查询外部、实时或需要核实的资料。日期筛选约束网页发布/更新时间，不表示事件有效期；结果包含原文片段与来源，相关性分数不表示事实可信度。房间内数据使用对应工具。",
    schema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description:
            "Search query in Chinese or English. Keep it concise (<400 chars), " +
            "use keywords like a search engine, not full sentences. " +
            "Good: '北京三里屯餐厅推荐', '2026年5月新电影'. " +
            "Bad: '你能帮我查一下附近有什么好吃的吗？'"
        },
        maxResults: {
          type: "number",
          description: "Number of results to return (1-10). Default: 5."
        },
        searchDepth: {
          type: "string",
          enum: ["basic", "advanced"],
          description:
            "Search depth. 'basic' (default, 1 credit) for most cases, " +
            "'advanced' (2 credits) for deep research requiring higher relevance."
        },
        topic: { type: "string", enum: ["general", "news"], description: "Use news for recent events and warnings." },
        timeRange: { type: "string", enum: ["day", "week", "month", "year"], description: "Publication/update window before now; do not combine with startDate/endDate." },
        startDate: { type: "string", description: "Earliest publication/update date, YYYY-MM-DD. Not the travel date." },
        endDate: { type: "string", description: "Latest publication/update date, YYYY-MM-DD." },
        includeDomains: { type: "array", items: { type: "string" }, description: "Restrict to at most ten source domains, such as nmc.cn. Use bare domains, without paths or schemes." }
      }
    },
    async execute(input: SearchInput, context: ToolExecutionContext) {
      const { query, maxResults = 5, searchDepth = "basic", ...constraints } = searchInputSchema.parse(input);
      return fetchSearchResults(query, maxResults, searchDepth, context.signal, constraints);
    }
  };
}

function mockSearch(query: string, fallbackReason?: string, constraints: SearchConstraints = {}): SearchOutput {
  return {
    provider: "mock",
    availability: "unavailable",
    query,
    fetchedAt: new Date().toISOString(),
    constraints,
    results: [],
    fallbackReason,
    _meta: { totalResults: 0, displayMode: "inline" }
  };
}

async function callTavilyAPI(
  query: string,
  maxResults: number,
  searchDepth: "basic" | "advanced",
  apiKey: string,
  signal?: AbortSignal,
  constraints: SearchConstraints = {}
): Promise<SearchOutput> {
  const controller = signal ? null : new AbortController();
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    : null;

  try {
    const startTime = Date.now();
    const response = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: signal ?? controller?.signal,
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: false,
        include_published_date: true,
        filter_by_published_date: false,
        include_images: false,
        include_raw_content: false,
        topic: constraints.topic,
        time_range: constraints.timeRange,
        start_date: constraints.startDate,
        end_date: constraints.endDate,
        include_domains: constraints.includeDomains,
        include_domains_mode: constraints.includeDomains ? "restrict" : undefined
      })
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");

      if (response.status === 401 || response.status === 403) {
        throw new Error(`API key invalid (${response.status})`);
      }

      if (response.status === 429) {
        throw new Error("Rate limit exceeded");
      }

      throw new Error(`Tavily API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as TavilyResponse;
    const responseTime = (Date.now() - startTime) / 1000;
    const fetchedAt = new Date().toISOString();

    return {
      provider: "tavily",
      query: data.query || query,
      availability: "available",
      fetchedAt,
      constraints,
      results: (data.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
        publishedDate: r.published_date || null,
        dateStatus: r.published_date && Number.isFinite(Date.parse(r.published_date)) ? "known" : "unknown",
        dateMeaning: "published_or_updated",
        fetchedAt
      })),
      responseTime,
      _meta: {
        totalResults: data.results?.length || 0,
        displayMode: "inline"
      }
    };
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);

    if (signal?.aborted) throw signal.reason ?? error;

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout after ${FETCH_TIMEOUT_MS}ms`);
    }

    throw error;
  }
}

export const __testing = {
  mockSearch,
  callTavilyAPI
};
