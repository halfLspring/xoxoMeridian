import type { AgentTool, ToolExecutionContext } from "@/agent/types";
import { weatherInputSchema } from "@/agent/tool-contracts";
import { TRANSIENT_TOOL_RETRY } from "@/agent/tool-errors";
import { resolveParticipantPair } from "@/lib/participant-resolution";

type WeatherInput = {
  city?: string;
  includeForecast?: boolean;
  startDate?: string;
  endDate?: string;
};

type CacheEntry<T> = { value: T; expiresAt: number };

const LOCATION_CACHE = new Map<string, CacheEntry<QWeatherLocation>>();
const WEATHER_CACHE = new Map<string, CacheEntry<QWeatherSnapshot>>();

const LOCATION_TTL_MS = 24 * 60 * 60 * 1000;
const WEATHER_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_SIZE = 500;

function evictOldest<K, V>(map: Map<K, CacheEntry<V>>, max: number) {
  if (map.size <= max) return;
  const oldest = map.keys().next().value;
  if (oldest !== undefined) map.delete(oldest);
}

const FETCH_TIMEOUT_MS = 8000;

type QWeatherLocation = {
  id: string;
  name: string;
  adm1?: string;
  adm2?: string;
  country?: string;
  tz?: string;
  lat?: string;
  lon?: string;
};

type QWeatherNow = {
  obsTime: string;
  temp: string;
  feelsLike: string;
  text: string;
  windDir: string;
  windScale: string;
  windSpeed: string;
  humidity: string;
  precip: string;
  pressure: string;
  vis: string;
  cloud?: string;
  icon?: string;
};

type QWeatherDaily = {
  fxDate: string;
  tempMax: string;
  tempMin: string;
  textDay: string;
  textNight: string;
  windDirDay?: string;
  windScaleDay?: string;
  humidity?: string;
  precip?: string;
  uvIndex?: string;
};

type QWeatherSnapshot = {
  location: QWeatherLocation;
  now: QWeatherNow;
  daily?: QWeatherDaily[];
  fetchedAt: string;
  issuedAt: string | null;
  sourceUrl: string | null;
  forecastDays: 0 | 3 | 7;
  fallbackReason?: string;
};

type WeatherQuery = Pick<WeatherInput, "startDate" | "endDate"> & { referenceTime?: string };
const DAY_MS = 86400000;

function datesBetween(start?: string, end?: string): string[] {
  if (!start || !end) return [];
  const length = Math.min(31, Math.floor((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1);
  return Array.from({ length }, (_, index) => new Date(Date.parse(start) + index * DAY_MS).toISOString().slice(0, 10));
}

function dateAtTimezone(referenceTime: string, timezone?: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(referenceTime));
}

function coverageFor(query: WeatherQuery, availableDates: string[], referenceDate: string | null, forecastDays: 0 | 3 | 7) {
  const startDate = query.startDate ?? (forecastDays ? referenceDate : null);
  const endDate = query.endDate ?? (startDate && forecastDays
    ? new Date(Date.parse(startDate) + (forecastDays - 1) * DAY_MS).toISOString().slice(0, 10) : null);
  return {
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    referenceDate,
    availableDates,
    missingDates: datesBetween(startDate ?? undefined, endDate ?? undefined).filter((date) => !availableDates.includes(date)),
    forecastDays
  };
}

type WeatherSnapshotResult = ReturnType<typeof formatSnapshot> | ReturnType<typeof mockWeather>;

export async function fetchWeatherSnapshot(
  cityInput: string,
  includeForecast = false,
  signal?: AbortSignal,
  query: WeatherQuery = {}
): Promise<WeatherSnapshotResult> {
  const parsed = weatherInputSchema.parse({ city: cityInput, includeForecast, startDate: query.startDate, endDate: query.endDate });
  const city = parsed.city!;
  if (signal?.aborted) throw signal.reason ?? new Error("Weather request aborted.");
  const referenceTime = query.referenceTime ?? new Date().toISOString();
  const request = { ...query, referenceTime };

  const provider = process.env.WEATHER_PROVIDER ?? "mock";
  const apiKey = process.env.WEATHER_API_KEY ?? "";

  if (provider !== "qweather") {
    console.warn(
      `[weather.get] using mock — WEATHER_PROVIDER="${provider}" (need "qweather")`
    );
    return mockWeather(city, `WEATHER_PROVIDER=${provider}`, request);
  }
  if (!apiKey) {
    console.warn("[weather.get] using mock — WEATHER_API_KEY is empty");
    return mockWeather(city, "WEATHER_API_KEY missing", request);
  }

  try {
    return await getQWeather(city, includeForecast || Boolean(query.startDate), apiKey, signal, request);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[weather.get] qweather call failed, falling back to mock: ${reason}`);
    return mockWeather(city, reason, request);
  }
}

export function createWeatherTool(): AgentTool<WeatherInput> {
  return {
    name: "weather.get",
    risk: "low",
    retry: TRANSIENT_TOOL_RETRY,
    description: "查询当前天气和最多七天的逐日预报；提供实际覆盖日期、缺口和来源时间，不提供灾害预警。",
    schema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "City name in Chinese or English. Defaults to the partner participant's city."
        },
        includeForecast: {
          type: "boolean",
          description: "When true, also fetch the 3-day forecast. A date range automatically requests a forecast of up to seven days from the reference date."
        },
        startDate: { type: "string", description: "First destination calendar date, YYYY-MM-DD. Supply together with endDate." },
        endDate: { type: "string", description: "Last destination calendar date, inclusive; requested range is limited to 31 dates." }
      }
    },
    async execute(input: WeatherInput, context: ToolExecutionContext) {
      const parsed = weatherInputSchema.parse(input);
      const city = parsed.city || inferPartnerCity(context) || "Beijing";
      return fetchWeatherSnapshot(city, Boolean(parsed.includeForecast), context.signal, {
        startDate: parsed.startDate, endDate: parsed.endDate, referenceTime: context.referenceTime
      });
    }
  };
}

function inferPartnerCity(context: ToolExecutionContext) {
  const { partner } = resolveParticipantPair(
    context.runtimeContext.participants,
    context.requestedById,
    (participant) => participant.userId
  );
  return partner?.user.profile?.city;
}

function mockWeather(city: string, fallbackReason?: string, query: WeatherQuery = {}) {
  return {
    provider: "mock" as const,
    availability: "unavailable" as const,
    city,
    condition: "未知",
    advice: "暂无真实天气数据，无法确认实况与预报。",
    fetchedAt: new Date().toISOString(),
    issuedAt: null,
    source: { name: "QWeather", url: null },
    coverage: coverageFor(query, [], null, 0),
    fallbackReason
  };
}

async function getQWeather(
  city: string,
  includeForecast: boolean,
  apiKey: string,
  signal: AbortSignal | undefined,
  query: WeatherQuery
) {
  const apiHost = (process.env.QWEATHER_API_HOST || "devapi.qweather.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const geoHost = (process.env.QWEATHER_GEOAPI_HOST || "geoapi.qweather.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const location = await resolveLocation(city, apiKey, geoHost, signal);
  const referenceDate = dateAtTimezone(query.referenceTime!, location.tz);
  const daysUntilEnd = query.endDate ? Math.floor((Date.parse(query.endDate) - Date.parse(referenceDate)) / DAY_MS) + 1 : 3;
  const forecastDays = includeForecast ? (daysUntilEnd > 3 ? 7 : 3) : 0;
  const cacheKey = `${apiHost}|${geoHost}|${city}|${forecastDays}|${referenceDate}`;
  const cached = WEATHER_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return formatSnapshot(cached.value, query, referenceDate);
  }

  const current = await fetchWeatherNow(location.id, apiKey, apiHost, signal);
  let forecast: QWeatherDailyResponse | undefined;
  let fallbackReason: string | undefined;
  if (forecastDays) {
    try {
      forecast = await fetchWeatherDaily(location.id, forecastDays, apiKey, apiHost, signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      fallbackReason = error instanceof Error ? error.message : String(error);
    }
  }
  const snapshot: QWeatherSnapshot = {
    location, now: current.now, daily: forecast?.daily,
    fetchedAt: new Date().toISOString(),
    issuedAt: (forecastDays ? forecast?.updateTime : current.updateTime) ?? null,
    sourceUrl: forecast?.fxLink ?? current.fxLink ?? null,
    forecastDays, fallbackReason
  };
  if (!fallbackReason) {
    evictOldest(WEATHER_CACHE, MAX_CACHE_SIZE);
    WEATHER_CACHE.set(cacheKey, { value: snapshot, expiresAt: Date.now() + WEATHER_TTL_MS });
  }
  return formatSnapshot(snapshot, query, referenceDate);
}

async function resolveLocation(
  city: string,
  apiKey: string,
  geoHost: string,
  signal?: AbortSignal
): Promise<QWeatherLocation> {
  const cacheKey = `${geoHost}|${city.toLowerCase()}`;
  const cached = LOCATION_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Dedicated QWeather hosts (e.g. xxx.re.qweatherapi.com) serve GeoAPI under
  // /geo/v2/..., while the legacy geoapi.qweather.com serves it under /v2/...
  const isDedicated = !/^geoapi\.qweather\.com$/i.test(geoHost);
  const geoPath = isDedicated ? "/geo/v2/city/lookup" : "/v2/city/lookup";

  const url = `https://${geoHost}${geoPath}?location=${encodeURIComponent(city)}&number=1&lang=zh`;
  const data = await qweatherFetch<{ code: string; location?: QWeatherLocation[] }>(url, apiKey, signal);
  const first = data.location?.[0];
  if (!first?.id) {
    throw new Error(`QWeather city lookup returned no result for "${city}" (code=${data.code})`);
  }

  evictOldest(LOCATION_CACHE, MAX_CACHE_SIZE);
  LOCATION_CACHE.set(cacheKey, { value: first, expiresAt: Date.now() + LOCATION_TTL_MS });
  return first;
}

async function fetchWeatherNow(
  locationId: string,
  apiKey: string,
  apiHost: string,
  signal?: AbortSignal
): Promise<{ now: QWeatherNow; updateTime?: string; fxLink?: string }> {
  const url = `https://${apiHost}/v7/weather/now?location=${encodeURIComponent(locationId)}&lang=zh&unit=m`;
  const data = await qweatherFetch<{ code: string; now?: QWeatherNow; updateTime?: string; fxLink?: string }>(url, apiKey, signal);
  if (!data.now) {
    throw new Error(`QWeather weather/now returned no payload (code=${data.code})`);
  }
  return { now: data.now, updateTime: data.updateTime, fxLink: data.fxLink };
}

type QWeatherDailyResponse = { code: string; daily?: QWeatherDaily[]; updateTime?: string; fxLink?: string };

async function fetchWeatherDaily(
  locationId: string,
  days: 3 | 7,
  apiKey: string,
  apiHost: string,
  signal?: AbortSignal
): Promise<QWeatherDailyResponse> {
  const url = `https://${apiHost}/v7/weather/${days}d?location=${encodeURIComponent(locationId)}&lang=zh&unit=m`;
  return qweatherFetch<QWeatherDailyResponse>(url, apiKey, signal);
}

async function qweatherFetch<T extends { code: string }>(
  url: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<T> {
  const controller = signal ? null : new AbortController();
  const timer = controller
    ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    : null;
  try {
    const response = await fetch(url, {
      headers: {
        "X-QW-Api-Key": apiKey,
        Accept: "application/json"
      },
      signal: signal ?? controller?.signal
    });
    if (!response.ok) {
      throw new Error(`QWeather request failed: HTTP ${response.status}`);
    }
    const data = (await response.json()) as T;
    if (data.code !== "200") {
      throw new Error(`QWeather API error code=${data.code}`);
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatSnapshot(snapshot: QWeatherSnapshot, query: WeatherQuery = {}, referenceDate: string | null = null) {
  const { location, now, daily } = snapshot;
  const coverage = coverageFor(query, [...new Set(daily?.map((day) => day.fxDate) ?? [])].sort(), referenceDate, snapshot.forecastDays);
  const availability = snapshot.fallbackReason || coverage.missingDates.length || (snapshot.forecastDays && !daily?.length)
    ? "partial" as const : "available" as const;
  const tempC = toNumber(now.temp);
  const feelsC = toNumber(now.feelsLike);

  return {
    provider: "qweather" as const,
    availability,
    fetchedAt: snapshot.fetchedAt,
    issuedAt: snapshot.issuedAt,
    source: { name: "QWeather", url: snapshot.sourceUrl },
    coverage,
    fallbackReason: snapshot.fallbackReason,
    city: location.name,
    region: [location.adm2, location.adm1, location.country].filter(Boolean).join(" / "),
    locationId: location.id,
    timezone: location.tz,
    condition: now.text,
    temperatureC: tempC,
    feelsLikeC: feelsC,
    humidityPercent: toNumber(now.humidity),
    wind: {
      direction: now.windDir,
      scale: now.windScale,
      speedKmh: toNumber(now.windSpeed)
    },
    precipitationMm: toNumber(now.precip),
    pressureHpa: toNumber(now.pressure),
    visibilityKm: toNumber(now.vis),
    observedAt: now.obsTime,
    forecast: daily?.map((d) => ({
      date: d.fxDate,
      tempMaxC: toNumber(d.tempMax),
      tempMinC: toNumber(d.tempMin),
      textDay: d.textDay,
      textNight: d.textNight,
      wind: { direction: d.windDirDay, scale: d.windScaleDay },
      humidityPercent: d.humidity ? toNumber(d.humidity) : undefined,
      precipitationMm: d.precip ? toNumber(d.precip) : undefined,
      uvIndex: d.uvIndex ? toNumber(d.uvIndex) : undefined
    })),
    advice: buildAdvice(now, daily)
  };
}

function toNumber(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function buildAdvice(now: QWeatherNow, daily?: QWeatherDaily[]) {
  const parts: string[] = [];
  const temp = toNumber(now.temp);
  if (temp !== undefined) {
    if (temp <= 5) parts.push("外面挺冷，记得穿厚外套。");
    else if (temp <= 12) parts.push("有点凉，加件薄外套合适。");
    else if (temp >= 30) parts.push("天气炎热，注意防晒补水。");
  }
  const precip = toNumber(now.precip);
  if (precip !== undefined && precip > 0) {
    parts.push("正在下雨，出门带把伞。");
  } else if (daily?.[0]?.precip && (toNumber(daily[0].precip) ?? 0) > 0) {
    parts.push("今天预计有降水，可以备一把伞。");
  }
  if (parts.length === 0) parts.push("天气还行，开心一天。");
  return parts.join(" ");
}

export const __testing = {
  LOCATION_CACHE,
  WEATHER_CACHE,
  formatSnapshot
};
