"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  Flame,
  Clock,
  Target,
  Sparkles,
  Play,
  Pause,
  Square,
  RotateCcw,
  Wifi,
} from "lucide-react";

import type { ChatUser, RoomSnapshot } from "@/components/chat/types";
import { MiniRoomChat } from "@/components/study/MiniRoomChat";
import { StudyRoomMembers } from "@/components/study/StudyRoomMembers";
import type { StudyMember } from "@/components/study/StudyRoomMembers";

// ── Types ──────────────────────────────────────────────────────────────────────

type TimerMode = "focus" | "short" | "long";
type TimerState = "idle" | "running" | "paused";

type FocusState = {
  status: TimerState;
  mode: TimerMode;
  plannedMinutes: number;
  remainingSeconds: number | null;
  startedAt: string | null;
  expectedEndAt: string | null;
  pausedAt: string | null;
  sessionKey?: string | null;
};

type StudyGoal = {
  id: string;
  text: string;
  done: boolean;
  sortOrder: number;
  localDate: string;
};

type StudyPageData = {
  room: { id: string; slug: string; name: string };
  currentUser: ChatUser;
  currentState: FocusState;
  goals: StudyGoal[];
  members: StudyMember[];
  recentSessions: Array<{
    id: string;
    userId: string;
    startedAt: string;
    endedAt: string;
    actualMinutes: number;
  }>;
  stats: {
    todayCount: number;
    todayMinutes: number;
    weekCount: number;
    weekMinutes: number;
    streakDays: number;
  };
  chatSnapshot: RoomSnapshot | null;
};

const TIMER_DURATIONS: Record<TimerMode, number> = {
  focus: 25,
  short: 5,
  long: 15,
};

const MODE_LABELS: Record<TimerMode, string> = {
  focus: "专注",
  short: "短休",
  long: "长休",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatSessionDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone, month: "short", day: "numeric",
  }).format(new Date(iso));
}

function formatSessionTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Timer Ring ─────────────────────────────────────────────────────────────────

function TimerRing({
  progress,
  isRunning,
}: {
  progress: number;
  isRunning: boolean;
}) {
  const R = 80;
  const C = 2 * Math.PI * R;

  return (
    <div className="relative flex items-center justify-center">
      {isRunning && (
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 200,
            height: 200,
            background: "#3a5b22",
            opacity: 0.06,
          }}
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <svg width={190} height={190} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={95}
          cy={95}
          r={R}
          fill="none"
          stroke="#dfead8"
          strokeWidth={8}
        />
        <motion.circle
          cx={95}
          cy={95}
          r={R}
          fill="none"
          stroke="#3a5b22"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - progress)}
          transition={{ duration: 0.6, ease: "linear" }}
        />
      </svg>
    </div>
  );
}

// ── Mode Tabs ─────────────────────────────────────────────────────────────────

function ModeTabs({
  mode,
  onModeChange,
  disabled,
}: {
  mode: TimerMode;
  onModeChange: (m: TimerMode) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex rounded-[10px] bg-sage-100/70 p-1 gap-1">
      {(Object.keys(MODE_LABELS) as TimerMode[]).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            disabled={disabled}
            className={`px-4 py-1.5 rounded-[8px] text-xs font-medium transition-colors ${active
              ? "bg-white text-[#3a5b22] shadow-sm"
              : "text-sage-700/60 hover:text-sage-700"
              }`}
          >
            {MODE_LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export function StudyDashboard({ initialData }: { initialData: StudyPageData }) {
  const [data, setData] = useState(initialData);
  const [mode, setMode] = useState<TimerMode>(initialData.currentState.mode);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [goalDraft, setGoalDraft] = useState("");
  const [goals, setGoals] = useState<StudyGoal[]>(initialData.goals);
  const autoStoppedRef = useRef(false);
  const currentUser = data.currentUser.profile ? data.currentUser
    : data.chatSnapshot?.room.participants.find(({ user }) => user.id === data.currentUser.id)?.user ?? data.currentUser;
  const timezone = currentUser.profile?.timezone || "UTC";

  const state = data.currentState;
  const isRunning = state.status === "running";
  const isPaused = state.status === "paused";
  const isActive = isRunning || isPaused;

  const plannedSeconds = (TIMER_DURATIONS[mode] ?? 25) * 60;

  const remainingSeconds = (() => {
    if (isRunning) {
      if (state.remainingSeconds !== null && state.remainingSeconds !== undefined) {
        const pausedAt = state.pausedAt ? new Date(state.pausedAt).getTime() : null;
        if (pausedAt) {
          return Math.max(0, state.remainingSeconds - Math.floor((nowMs - pausedAt) / 1000));
        }
      }
      if (state.expectedEndAt) {
        return Math.max(0, Math.ceil((new Date(state.expectedEndAt).getTime() - nowMs) / 1000));
      }
      const startedAt = state.startedAt ? new Date(state.startedAt).getTime() : nowMs;
      const elapsed = Math.floor((nowMs - startedAt) / 1000);
      return Math.max(0, plannedSeconds - elapsed);
    }
    if (isPaused && state.remainingSeconds !== null) {
      return state.remainingSeconds;
    }
    return plannedSeconds;
  })();

  const progress = plannedSeconds > 0 ? 1 - remainingSeconds / plannedSeconds : 0;
  const displayTime = formatCountdown(isActive ? remainingSeconds : plannedSeconds);

  // ── Tick ───────────────────────────────────────────────────────────────────

  // Keep time in state so renders stay deterministic while the clock advances.
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning, state.expectedEndAt]);

  // ── API handlers used by effects ────────────────────────────────────────────

  const refreshData = useCallback(async () => {
    const response = await fetch("/api/study", { cache: "no-store" });
    if (response.ok) {
      const result = await response.json();
      setData(result);
      setGoals(result.goals);
      if (result.currentState?.mode) {
        setMode(result.currentState.mode);
      }
    }
  }, []);

  const stopTimer = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/study/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey: state.sessionKey }),
      });
      if (response.ok) {
        await refreshData();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [refreshData, state.sessionKey]);

  // ── Auto-stop when timer reaches 0 ────────────────────────────────────────

  useEffect(() => {
    if (isRunning && remainingSeconds <= 0 && !autoStoppedRef.current) {
      autoStoppedRef.current = true;
      stopTimer();
    }
    if (!isRunning) {
      autoStoppedRef.current = false;
    }
  }, [isRunning, remainingSeconds, stopTimer]);

  // ── Presence heartbeat ─────────────────────────────────────────────────────

  useEffect(() => {
    // Post immediately and every 15 seconds
    const postPresence = () => {
      fetch("/api/study/presence", { method: "POST" }).catch(() => { });
    };
    postPresence();
    const interval = window.setInterval(postPresence, 15_000);
    return () => window.clearInterval(interval);
  }, []);

  // ── API handlers ───────────────────────────────────────────────────────────

  // Note: refreshData and stopTimer are defined above (before effects that reference them)

  const startTimer = useCallback(
    async (selectedMode: TimerMode) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const response = await fetch("/api/study/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: selectedMode }),
        });
        if (response.ok) {
          const result = await response.json();
          setNowMs(Date.now());
          setData((prev) => ({ ...prev, currentState: result.state }));
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const pauseTimer = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/study/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey: state.sessionKey }),
      });
      if (response.ok) {
        const result = await response.json();
        setNowMs(Date.now());
        setData((prev) => ({ ...prev, currentState: result.state }));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [state.sessionKey]);

  const resumeTimer = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/study/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey: state.sessionKey }),
      });
      if (response.ok) {
        const result = await response.json();
        setNowMs(Date.now());
        setData((prev) => ({ ...prev, currentState: result.state }));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [state.sessionKey]);

  const createGoal = useCallback(async () => {
    const text = goalDraft.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/study/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (response.ok) {
        const result = await response.json();
        setGoals((prev) => [...prev, result.goal]);
        setGoalDraft("");
        await refreshData();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [goalDraft, refreshData]);

  const toggleGoal = useCallback(
    async (goal: StudyGoal) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const response = await fetch(`/api/study/goals/${goal.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ done: !goal.done }),
        });
        if (response.ok) {
          const result = await response.json();
          setGoals((prev) =>
            prev.map((g) => (g.id === goal.id ? result.goal : g)),
          );
          await refreshData();
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refreshData],
  );

  const deleteGoal = useCallback(
    async (goal: StudyGoal) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const response = await fetch(`/api/study/goals/${goal.id}`, {
          method: "DELETE",
        });
        if (response.ok) {
          setGoals((prev) => prev.filter((g) => g.id !== goal.id));
          await refreshData();
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refreshData],
  );

  // ── Derived display values ─────────────────────────────────────────────────

  const todayFocusStr =
    data.stats.todayMinutes > 0
      ? formatMinutes(data.stats.todayMinutes)
      : "0m";

  const onlineCount = data.members.filter((m) => m.online).length;
  const startButtonLabel = mode === "focus" ? "开始专注" : "开始休息";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 text-ink">
      {/* ── Header ── */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[10px] border border-sage-100 bg-white/90 px-6 py-4 flex items-center justify-between shadow-sm"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-sage-100 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-[#3a5b22]" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-black">
              心流屋
            </h1>
            <p className="text-[11px] text-black/40">
              {data.room.name} · {onlineCount} 人在线
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-sage-700/60">
          <Wifi className="w-3.5 h-3.5" />
          <span>环境静谧</span>
        </div>
      </motion.header>

      {/* ── Main Grid: Left | Center | Right ── */}
      <div className="grid gap-5 lg:grid-cols-[240px_1fr_280px]">
        {/* ── Left Column ── */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.08 }}
          className="flex flex-col gap-4"
        >
          {/* Stats Card */}
          <section className="rounded-[10px] border border-sage-100 bg-white/90 p-5">
            <h2 className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-4">
              概览
            </h2>
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <Flame className="w-4 h-4 text-orange-400 shrink-0" />
                <span className="text-xs text-black/60 flex-1">专注番茄</span>
                <span className="text-sm font-semibold text-[#3a5b22]">
                  {data.stats.todayCount} 个
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-[#3a5b22] shrink-0" />
                <span className="text-xs text-black/60 flex-1">累计专注</span>
                <span className="text-sm font-semibold text-black">
                  {todayFocusStr}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <Target className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-xs text-black/60 flex-1">本周番茄</span>
                <span className="text-sm font-semibold text-[#3a5b22]">
                  {data.stats.weekCount} 个
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-xs text-black/60 flex-1">连续天数</span>
                <span className="text-sm font-semibold text-black">
                  {data.stats.streakDays} 天
                </span>
              </div>
            </div>
          </section>

          {/* Goals Card */}
          <section className="rounded-[10px] border border-sage-100 bg-white/90 p-5">
            <h2 className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-4">
              今日清单
            </h2>
            {goals.length === 0 && goalDraft.length === 0 ? (
              <p className="text-xs text-black/30 leading-relaxed">
                专注时记录待办事项。
                <br />
                完成一项勾选一项。
              </p>
            ) : (
              <div className="space-y-2 mb-3">
                {goals.map((goal) => (
                  <div
                    key={goal.id}
                    className="flex items-center gap-2 w-full text-left rounded-[8px] px-2 py-1.5 hover:bg-sage-50 transition-colors disabled:opacity-50"
                  >
                    <button
                      type="button"
                      onClick={() => toggleGoal(goal)}
                      disabled={busy}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-50"
                    >
                      <div
                        className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${goal.done
                          ? "bg-[#3a5b22] border-[#3a5b22]"
                          : "border-sage-200"
                          }`}
                      >
                        {goal.done && (
                          <svg
                            width="10"
                            height="8"
                            viewBox="0 0 10 8"
                            fill="none"
                          >
                            <path
                              d="M1 4l2.5 2.5L9 1"
                              stroke="white"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </div>
                      <span
                        className={`min-w-0 flex-1 truncate text-xs ${goal.done
                          ? "text-black/30 line-through"
                          : "text-black/70"
                          }`}
                      >
                        {goal.text}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteGoal(goal)}
                      disabled={busy}
                      aria-label={`删除清单项：${goal.text}`}
                      className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-black/25 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* Add goal input */}
            <div className="flex gap-2">
              <input
                type="text"
                aria-label="添加待办"
                className="flex-1 min-w-0 h-8 rounded-[8px] border border-sage-200 bg-white px-2.5 text-xs outline-none transition-colors placeholder:text-black/30 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15"
                placeholder="添加待办…"
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    createGoal();
                  }
                }}
                disabled={busy}
              />
              <button
                type="button"
                className="shrink-0 h-8 rounded-[8px] bg-[#3a5b22] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#2e4a1a] disabled:opacity-50"
                disabled={busy || !goalDraft.trim()}
                onClick={createGoal}
              >
                添加
              </button>
            </div>
          </section>
        </motion.div>

        {/* ── Center Column ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04 }}
          className="flex flex-col gap-4"
        >
          {/* Timer Card */}
          <section className="rounded-[10px] border border-sage-100 bg-white/90 p-8 flex flex-col items-center shadow-sm">
            {/* Mode tabs */}
            <ModeTabs
              mode={mode}
              onModeChange={setMode}
              disabled={isActive}
            />

            {/* Ring + Time display */}
            <div className="relative flex items-center justify-center mt-6 mb-5">
              <TimerRing progress={progress} isRunning={isRunning} />
              <div className="absolute flex flex-col items-center">
                <motion.div
                  key={mode}
                  className="text-[10px] font-semibold uppercase tracking-widest mb-1 text-[#3a5b22]/60"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.6 }}
                >
                  {MODE_LABELS[mode]}
                </motion.div>
                <motion.div
                  key={`${displayTime}-${isRunning}`}
                  className="text-5xl font-bold tabular-nums text-black"
                  animate={isRunning ? { opacity: [1, 0.85, 1] } : {}}
                  transition={{ duration: 2.4, repeat: Infinity }}
                >
                  {displayTime}
                </motion.div>
                {/* Pomodoro dots */}
                <div className="flex gap-1 mt-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="w-2 h-2 rounded-full transition-colors duration-300"
                      style={{
                        backgroundColor:
                          i < data.stats.todayCount % 4
                            ? "#3a5b22"
                            : "#dfead8",
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              <AnimatePresence mode="wait">
                {isRunning && (
                  <motion.div
                    key="running-controls"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="flex items-center gap-2"
                  >
                    <motion.button
                      type="button"
                      onClick={pauseTimer}
                      whileTap={{ scale: 0.94 }}
                      className="rounded-[10px] border border-[#3a5b22] px-4 py-2 text-sm font-medium text-[#3a5b22] transition-colors hover:bg-[#3a5b22]/5 disabled:opacity-50 flex items-center gap-1.5"
                      disabled={busy}
                    >
                      <Pause className="w-4 h-4" />
                      暂停
                    </motion.button>
                    <motion.button
                      type="button"
                      onClick={stopTimer}
                      whileTap={{ scale: 0.94 }}
                      className="rounded-[10px] bg-[#3a5b22] px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2f4d1c] disabled:opacity-50 flex items-center gap-1.5"
                      disabled={busy}
                    >
                      <Square className="w-3.5 h-3.5" />
                      停止
                    </motion.button>
                  </motion.div>
                )}

                {isPaused && (
                  <motion.div
                    key="paused-controls"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="flex items-center gap-2"
                  >
                    <motion.button
                      type="button"
                      onClick={resumeTimer}
                      whileTap={{ scale: 0.94 }}
                      className="rounded-[10px] bg-[#3a5b22] px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2f4d1c] disabled:opacity-50 flex items-center gap-1.5"
                      disabled={busy}
                    >
                      <Play className="w-4 h-4" />
                      继续
                    </motion.button>
                    <motion.button
                      type="button"
                      onClick={stopTimer}
                      whileTap={{ scale: 0.94 }}
                      className="rounded-[10px] border border-sage-100 px-4 py-2 text-sm font-medium text-sage-700/70 transition-colors hover:bg-sage-50 disabled:opacity-50 flex items-center gap-1.5"
                      disabled={busy}
                    >
                      <Square className="w-3.5 h-3.5" />
                      停止
                    </motion.button>
                  </motion.div>
                )}

                {!isActive && (
                  <motion.button
                    key="start"
                    type="button"
                    onClick={() => startTimer(mode)}
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    whileTap={{ scale: 0.94 }}
                    className="rounded-[10px] bg-[#3a5b22] px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2f4d1c] disabled:opacity-50 flex items-center gap-1.5"
                    disabled={busy}
                  >
                    <Play className="w-4 h-4" />
                    {startButtonLabel}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            {/* Reset button (idle only) */}
            {!isActive && (
              <button
                type="button"
                onClick={() => setMode("focus")}
                className="mt-3 flex items-center gap-1 text-[11px] text-black/25 hover:text-black/40 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                重置
              </button>
            )}

            {/* Status text */}
            <AnimatePresence>
              {isRunning && (
                <motion.p
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="text-xs text-black/40 mt-4"
                >
                  专注中 · 保持专注，你做得很好 ✨
                </motion.p>
              )}
              {isPaused && (
                <motion.p
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="text-xs text-black/40 mt-4"
                >
                  已暂停 · 随时可以继续 ⏸
                </motion.p>
              )}
            </AnimatePresence>
          </section>

          {/* Ambient Sounds Card */}
          <section className="rounded-[10px] border border-sage-100 bg-white/90 p-5">
            <h2 className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-4">
              氛围音效
            </h2>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "雨声", icon: "🌧" },
                { label: "咖啡馆", icon: "☕" },
                { label: "森林", icon: "🌿" },
                { label: "轻音乐", icon: "🎵" },
              ].map((sound) => (
                <div
                  key={sound.label}
                  className="flex flex-col items-center gap-1 rounded-[10px] border border-sage-100 bg-sage-50/70 px-2 py-3 text-center opacity-50 cursor-not-allowed"
                  title="即将推出"
                >
                  <span className="text-lg">{sound.icon}</span>
                  <span className="text-[10px] text-black/40">
                    {sound.label}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Motivation strip */}
          <div className="rounded-[10px] border border-sage-100 bg-gradient-to-r from-sage-100/80 to-skysoft-50 px-5 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-black">
                今日已专注 {todayFocusStr}
              </p>
              <p className="text-xs text-black/40">
                {data.stats.weekCount > 0
                  ? `本周累计 ${data.stats.weekCount} 次 · 继续加油 🌱`
                  : "开始你的第一次专注吧 🌱"}
              </p>
            </div>
            <div className="flex gap-0.5 items-end">
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1.5 rounded-sm"
                  style={{
                    backgroundColor:
                      i < Math.min(data.stats.todayCount, 7)
                        ? "#3a5b22"
                        : "#dfead8",
                    height: 8 + (i % 3) * 4,
                  }}
                />
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── Right Column ── */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.08 }}
          className="flex flex-col gap-4"
        >
          {/* Study Members */}
          <StudyRoomMembers members={data.members} />

          {/* Mini Room Chat */}
          <div className="rounded-[10px] border border-sage-100 bg-white/90 shadow-sm overflow-hidden">
            {data.chatSnapshot && data.currentUser ? (
              <MiniRoomChat
                currentUser={currentUser}
                initialSnapshot={data.chatSnapshot}
              />
            ) : (
              <div className="flex flex-col h-[360px]">
                <div className="shrink-0 border-b border-sage-100 bg-sage-50/60 px-4 py-3">
                  <h3 className="text-sm font-semibold text-[#3a5b22]">悄悄话</h3>
                </div>
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-xs text-black/30">加载中…</p>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Recent Sessions ── */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
        className="rounded-[10px] border border-sage-100 bg-white/90 p-6 shadow-sm"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-black/50 uppercase tracking-wider">
            最近记录
          </h2>
        </div>
        <div className="mt-4 space-y-2">
          {data.recentSessions.length === 0 ? (
            <p className="text-xs text-black/40 py-4 text-center">
              还没有完成的专注记录。
            </p>
          ) : (
            data.recentSessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between rounded-[10px] border border-sage-100 bg-sage-50/70 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-black">
                    {session.actualMinutes} 分钟
                  </p>
                  <p className="text-xs text-black/40">
                    {formatSessionDate(session.startedAt, timezone)}
                    {" · "}
                    {formatSessionTime(session.startedAt, timezone)}
                    {" — "}
                    {formatSessionTime(session.endedAt, timezone)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.section>
    </div>
  );
}

// Re-export StudyPageData type for tests
export type { StudyPageData };
