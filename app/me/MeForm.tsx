"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { notifySessionLogout } from "@/lib/session-logout";

type Initial = {
  displayName: string;
  city: string;
  country: string;
  profileNote: string;
};

const NOTE_LIMIT = 2000;

export function MeForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineMsg, setRefineMsg] = useState("");
  const previousNoteRef = useRef<string | null>(null);
  const [hasUndo, setHasUndo] = useState(false);

  const update = <K extends keyof Initial>(key: K, value: Initial[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setStatus("idle");
  };

  const onRefineNote = async () => {
    const text = form.profileNote.trim();
    if (!text || refining) return;
    setRefining(true);
    setRefineMsg("");
    try {
      const resp = await fetch("/api/profile/refine-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: form.profileNote }),
      });
      if (resp.status === 429) {
        setRefineMsg("优化太频繁了，稍后再试。");
        return;
      }
      if (!resp.ok) {
        setRefineMsg("优化失败，稍后再试。");
        return;
      }
      const data = (await resp.json()) as { refined: string; reason?: string };
      if (data.reason === "llm_disabled") {
        setRefineMsg("未配置 LLM，无法优化。");
        return;
      }
      previousNoteRef.current = form.profileNote;
      setHasUndo(true);
      update("profileNote", data.refined);
      setRefineMsg("已优化，可点撤销恢复。");
    } catch {
      setRefineMsg("优化失败，稍后再试。");
    } finally {
      setRefining(false);
    }
  };

  const onUndoRefine = () => {
    if (previousNoteRef.current === null) return;
    update("profileNote", previousNoteRef.current);
    previousNoteRef.current = null;
    setHasUndo(false);
    setRefineMsg("已恢复。");
  };

  const [loggingOut, setLoggingOut] = useState(false);
  const onLogout = async () => {
    if (loggingOut) return;
    if (!confirm("确认退出登录？")) return;
    console.log("[Logout] starting logout process...");
    setLoggingOut(true);
    try {
      console.log("[Logout] calling /api/auth/logout...");
      const response = await fetch("/api/auth/logout", { method: "POST" });
      console.log("[Logout] logout response:", response.status);
      if (response.ok) notifySessionLogout();
    } catch (error) {
      console.error("[Logout] logout failed:", error);
    } finally {
      // 清理客户端状态
      try {
        console.log("[Logout] clearing sessionStorage...");
        sessionStorage.removeItem("xoxo_last_redirect");
      } catch {
        // sessionStorage 不可用时忽略
      }
      // 使用硬刷新确保所有组件和连接被完全清理
      console.log("[Logout] redirecting to / with hard refresh...");
      window.location.replace(`/?logout=${Date.now()}`);
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrorMsg("");

    try {
      const response = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: form.displayName.trim() || undefined,
          city: form.city.trim() || undefined,
          country: form.country.trim() || undefined,
          profileNote: form.profileNote,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `保存失败：${response.status}`);
      }
      setStatus("saved");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const noteLength = form.profileNote.length;

  return (
    <form className="space-y-5 rounded-[10px] border border-[#e8e8e8] bg-white p-6" onSubmit={onSubmit}>
      <Field label="昵称">
        <input
          className="w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] leading-normal outline-hidden transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15"
          maxLength={40}
          onChange={(event) => update("displayName", event.target.value)}
          type="text"
          value={form.displayName}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="城市">
          <input
            className="w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] leading-normal outline-hidden transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15"
            onChange={(event) => update("city", event.target.value)}
            type="text"
            value={form.city}
          />
        </Field>
        <Field label="国家">
          <input
            className="w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] leading-normal outline-hidden transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15"
            onChange={(event) => update("country", event.target.value)}
            type="text"
            value={form.country}
          />
        </Field>
      </div>

      <Field label={`自我介绍 / 给助手的背景说明（${noteLength}/${NOTE_LIMIT}）`}>
        <textarea
          className="min-h-[160px] w-full resize-y rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] leading-normal outline-hidden transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15"
          maxLength={NOTE_LIMIT}
          onChange={(event) => update("profileNote", event.target.value)}
          placeholder="例如：我偏爱吃酸的；我喜欢夏天；遇到事情我不是不愿意承认错误，而是讨厌被冤枉。"
          value={form.profileNote}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefineNote}
            disabled={refining || !form.profileNote.trim()}
            className="rounded-[10px] border border-[#d9d9d9] bg-white px-3 py-1.5 text-xs font-medium text-[#3a5b22] transition-colors duration-200 hover:bg-[#3a5b22] hover:text-white focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden disabled:opacity-50 cursor-pointer"
          >
            {refining ? "优化中…" : "小助手优化"}
          </button>
          {hasUndo ? (
            <button
              type="button"
              onClick={onUndoRefine}
              className="rounded-[10px] border border-[#d9d9d9] bg-white px-3 py-1.5 text-xs text-black/60 transition-colors duration-200 hover:bg-neutral-50 focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden cursor-pointer"
            >
              撤销
            </button>
          ) : null}
          {refineMsg ? <span className="text-xs text-black/50">{refineMsg}</span> : null}
        </div>
      </Field>

      <div className="flex items-center justify-end gap-3">
        {status === "saved" ? <span className="text-xs text-[#3a5b22]">已保存</span> : null}
        {status === "error" ? <span className="text-xs text-red-700">{errorMsg}</span> : null}
        <button
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
          className="rounded-[10px] border border-red-200 bg-white px-4 py-2.5 text-sm text-red-600 transition-colors duration-200 hover:bg-red-50 focus:ring-2 focus:ring-red-500/15 focus:outline-hidden disabled:opacity-50 cursor-pointer"
        >
          {loggingOut ? "退出中…" : "退出登录"}
        </button>
        <button
          className="rounded-[10px] bg-[#3a5b22] px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#2e4a1a] focus:ring-2 focus:ring-[#3a5b22]/30 focus:outline-hidden disabled:opacity-50 cursor-pointer"
          disabled={saving}
          type="submit"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[15px] font-medium leading-none text-black">{label}</span>
      {children}
    </label>
  );
}
