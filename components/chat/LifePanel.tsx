"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { ChatUser, LifeMemo, LifeScheduledJob } from "@/components/chat/types";
import { MemoModal, ScheduledJobModal } from "@/components/chat/LifePanelModals";
import { ItemActions } from "@/components/chat/ItemActions";
import { useWorldClock } from "@/components/chat/useWorldClock";
import { resolveParticipantPair } from "@/lib/participant-resolution";
import { showError } from "@/lib/ui-utils";

type WeatherSnapshot = {
  provider: "qweather" | "mock";
  city?: string;
  condition?: string;
  temperatureC?: number;
  feelsLikeC?: number;
  humidityPercent?: number;
  wind?: { direction?: string; scale?: string };
  advice?: string;
  fallbackReason?: string;
};

type WeatherResult = {
  subject: "self" | "partner";
  displayName: string;
  city: string | null;
  snapshot: WeatherSnapshot | null;
  error: string | null;
};

const WEATHER_REFRESH_MS = 10 * 60 * 1000;

export function LifePanel({
  currentUserId,
  roomId,
  participants,
  memos,
  scheduledJobs
}: {
  currentUserId: string;
  roomId: string;
  participants: ChatUser[];
  memos: LifeMemo[];
  scheduledJobs: LifeScheduledJob[];
}) {
  const router = useRouter();
  // 两地时间取自组件之外的挂钟 store：SSR 与 hydration 都拿到 0（占位），
  // 挂载后才补上浏览器读数，两端渲染期都不读 Date，因此不会 hydration mismatch。
  const nowMs = useWorldClock();
  const [weatherState, setWeatherState] = useState<{
    roomId: string;
    result: WeatherResult | null;
    loaded: boolean;
  }>({ roomId, result: null, loaded: false });
  const [deletingItem, setDeletingItem] = useState<string | null>(null);

  type ModalState =
    | { type: "memo"; item?: LifeMemo }
    | { type: "job"; item?: LifeScheduledJob }
    | { type: null };

  const [modal, setModal] = useState<ModalState>({ type: null });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`/api/rooms/${roomId}/weather?who=partner`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as { results?: WeatherResult[] };
        if (cancelled) return;
        setWeatherState({ roomId, result: payload.results?.[0] ?? null, loaded: true });
      } catch {
        if (!cancelled) setWeatherState({ roomId, result: null, loaded: true });
      }
    }

    void load();
    const timer = setInterval(load, WEATHER_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [roomId]);

  const weather = weatherState.roomId === roomId ? weatherState.result : null;
  const weatherLoading = weatherState.roomId !== roomId || !weatherState.loaded;

  const { self: selfUser, partner: partnerUser } = resolveParticipantPair(
    participants,
    currentUserId,
    (participant) => participant.id
  );

  const handleDelete = async (
    type: "scheduled-jobs" | "memos",
    id: string,
    confirmMsg: string
  ) => {
    if (deletingItem) return;
    if (!confirm(confirmMsg)) return;

    setDeletingItem(id);
    try {
      const resp = await fetch(`/api/rooms/${roomId}/${type}/${id}`, {
        method: "DELETE",
      });
      if (!resp.ok) throw new Error(`删除失败: ${resp.status}`);
      router.refresh();
    } catch (err) {
      showError(err, "删除失败");
    } finally {
      setDeletingItem(null);
    }
  };

  const handleModalSuccess = () => {
    setModal({ type: null });
    router.refresh();
  };

  return (
    <aside className="hidden min-h-0 w-80 shrink-0 overflow-y-auto border-l border-[#e8e8e8] bg-white p-4 xl:block">
      <div className="space-y-4">
        <section className="rounded-[10px] border border-[#e8e8e8] bg-[#fafbfc] p-4">
          <h2 className="text-sm font-semibold text-black">两地时间</h2>
          <div className="mt-3 space-y-3 text-sm">
            {[selfUser, partnerUser]
              .filter((user): user is ChatUser => user !== null)
              .map((user) => (
                <div key={user.id} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-black">{user.displayName}</p>
                    <p className="text-xs text-black/50">{user.profile?.city ?? "未设置城市"}</p>
                  </div>
                  <p className="text-right font-semibold text-[#3a5b22]">{formatTime(nowMs, user.profile?.timezone)}</p>
                </div>
              ))}
          </div>
        </section>

        <section className="rounded-[10px] border border-[#e8e8e8] bg-[#fafbfc] p-4">
          <h2 className="text-sm font-semibold text-black">天气</h2>
          {weatherLoading && !weather ? (
            <p className="mt-2 text-sm leading-6 text-black/50">读取天气中…</p>
          ) : weather?.snapshot ? (
            <WeatherCard result={weather} />
          ) : (
            <p className="mt-2 text-sm leading-6 text-black/50">
              {weather?.error === "city not set on profile"
                ? `${weather.displayName ?? "对方"}还没有设置城市`
                : "暂时拿不到天气，稍后会自动重试。"}
            </p>
          )}
        </section>

        <PanelSection
          title="任务"
          empty="还没有任务"
          onAdd={() => setModal({ type: "job" })}
        >
          {scheduledJobs.map((job) => {
            const description = typeof job.payload?.description === "string" ? job.payload.description : null;
            const prompt = typeof job.payload?.prompt === "string" ? job.payload.prompt : null;
            const runOnce = job.payload?.runOnce === true;
            return (
              <div key={job.id} className="group relative rounded-[10px] border border-[#e8e8e8] bg-white p-3 text-sm">
                <p className="font-medium text-black">{description ?? prompt ?? job.cron}</p>
                <p className="mt-1 text-xs text-black/50">
                  {runOnce
                    ? `一次性 · ${formatDateTime(job.nextRunAt, job.timezone)}`
                    : `下次：${formatDateTime(job.nextRunAt, job.timezone)} · ${job.cron}`}
                </p>
                <ItemActions
                  onEdit={() => setModal({ type: "job", item: job })}
                  onDelete={() => handleDelete("scheduled-jobs", job.id, "确定要停用这个任务吗？")}
                  isDeleting={deletingItem === job.id}
                  editTitle="编辑任务"
                  deleteTitle="停用任务"
                />
              </div>
            );
          })}
        </PanelSection>

        <PanelSection
          title="备忘录"
          empty="还没有备忘录"
          onAdd={() => setModal({ type: "memo" })}
        >
          {memos.map((memo) => (
            <div key={memo.id} className="group relative rounded-[10px] border border-[#e8e8e8] bg-white p-3 text-sm">
              <p className="font-medium text-black">{memo.title}</p>
              <p className="mt-1 leading-5 text-black/60">{memo.content}</p>
              <ItemActions
                onEdit={() => setModal({ type: "memo", item: memo })}
                onDelete={() => handleDelete("memos", memo.id, "确定要删除这条备忘录吗？")}
                isDeleting={deletingItem === memo.id}
                editTitle="编辑备忘录"
                deleteTitle="删除备忘录"
              />
            </div>
          ))}
        </PanelSection>
      </div>

      <MemoModal
        isOpen={modal.type === "memo"}
        onClose={() => setModal({ type: null })}
        roomId={roomId}
        memo={modal.type === "memo" ? modal.item : undefined}
        onSuccess={handleModalSuccess}
      />
      <ScheduledJobModal
        isOpen={modal.type === "job"}
        onClose={() => setModal({ type: null })}
        roomId={roomId}
        job={modal.type === "job" ? modal.item : undefined}
        currentUserId={currentUserId}
        participants={participants}
        onSuccess={handleModalSuccess}
      />
    </aside>
  );
}

function PanelSection({ title, empty, children, onAdd }: { title: string; empty: string; children: React.ReactNode; onAdd?: () => void }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-black">{title}</h2>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="rounded-[10px] border border-[#d9d9d9] bg-white px-2.5 py-1 text-xs font-medium text-[#3a5b22] transition-colors duration-200 hover:bg-[#3a5b22] hover:text-white focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden cursor-pointer"
            title={`新建${title}`}
          >
            + 新建
          </button>
        )}
      </div>
      <div className="space-y-2">{hasChildren ? children : <p className="rounded-[10px] border border-dashed border-black/10 p-3 text-sm text-black/40">{empty}</p>}</div>
    </section>
  );
}

function formatTime(nowMs: number, timezone?: string) {
  // nowMs 为 0 表示还没拿到浏览器时刻（SSR/hydration 首帧），沿用无时区时的占位符。
  if (!timezone || nowMs === 0) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(nowMs));
}

function formatDateTime(value: string, timezone?: string | null) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone || "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function WeatherCard({ result }: { result: WeatherResult }) {
  const snap = result.snapshot!;
  const isMock = snap.provider !== "qweather";
  const city = snap.city ?? result.city ?? result.displayName;
  const tempC = snap.temperatureC;
  const feelsC = snap.feelsLikeC;
  const wind = snap.wind?.direction && snap.wind?.scale ? `${snap.wind.direction} ${snap.wind.scale} 级` : null;

  const line1Parts = [
    `${city}${snap.condition ? `，${snap.condition}` : ""}`,
    tempC !== undefined ? `${tempC}°C` : null,
    feelsC !== undefined ? `体感 ${feelsC}°C` : null
  ].filter(Boolean);

  const line2Parts = [
    snap.humidityPercent !== undefined ? `湿度 ${snap.humidityPercent}%` : null,
    wind
  ].filter(Boolean);

  return (
    <div className="mt-2 space-y-1 text-sm leading-6 text-black/70">
      <p className="text-black">{line1Parts.join("，")}</p>
      {line2Parts.length ? <p className="text-xs text-black/50">{line2Parts.join(" · ")}</p> : null}
      {snap.advice ? <p className="text-xs text-black/50">{snap.advice}</p> : null}
      {isMock ? (
        <p className="text-[11px] text-amber-700/80">
          正在使用 Mock 数据{snap.fallbackReason ? `（${snap.fallbackReason}）` : ""}
        </p>
      ) : null}
    </div>
  );
}
