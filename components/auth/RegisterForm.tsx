"use client";

import { useState } from "react";

import { PasswordInput } from "@/components/auth/PasswordInput";

export function RegisterForm({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");

    try {
      // Best-effort timezone capture so the agent's time-aware tools have a
      // reasonable default. Falls back to UTC server-side if the browser
      // refuses to expose this.
      const timezone =
        typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName, inviteCode, timezone }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "注册失败");
        setSubmitting(false);
        return;
      }

      const payload = (await response.json().catch(() => null)) as {
        user?: { id: string };
      } | null;

      const expectedUserId = payload?.user?.id;
      const probe = await fetch(
        expectedUserId ? `/api/auth/me?expect=${encodeURIComponent(expectedUserId)}` : "/api/auth/me",
        { cache: "no-store", credentials: "same-origin" }
      );
      if (!probe.ok) {
        setError(
          "注册成功，但浏览器没有切换到该账号。请清理旧登录 Cookie 后重试。"
        );
        setSubmitting(false);
        return;
      }

      window.location.replace(`/home`);
    } catch {
      setError("注册请求失败，请稍后重试。");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="register-email" className="text-[15px] font-medium leading-none text-black">邮箱</label>
        <input
          id="register-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="输入邮箱地址"
          autoComplete="email"
          required
          disabled={submitting}
          className="w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] font-medium leading-normal text-black placeholder:text-[#b0b0b0] placeholder:text-sm transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden disabled:cursor-not-allowed disabled:bg-neutral-50"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="register-display-name" className="text-[15px] font-medium leading-none text-black">昵称</label>
        <input
          id="register-display-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="聊天里看到的名字"
          maxLength={40}
          required
          disabled={submitting}
          className="w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] font-medium leading-normal text-black placeholder:text-[#b0b0b0] placeholder:text-sm transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden disabled:cursor-not-allowed disabled:bg-neutral-50"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="register-password" className="text-[15px] font-medium leading-none text-black">密码</label>
        <PasswordInput
          id="register-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="至少 8 位"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={submitting}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="register-invite-code" className="text-[15px] font-medium leading-none text-black">邀请码</label>
        <input
          id="register-invite-code"
          type="text"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          placeholder="输入邀请码"
          autoComplete="one-time-code"
          required
          disabled={submitting}
          className="w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] font-medium leading-normal text-black placeholder:text-[#b0b0b0] placeholder:text-sm transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden disabled:cursor-not-allowed disabled:bg-neutral-50"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="mt-1 w-full min-h-[44px] rounded-[10px] bg-[#3a5b22] px-4 py-3 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[#2e4a1a] focus:ring-2 focus:ring-[#3a5b22]/30 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        {submitting ? "注册中…" : "注册"}
      </button>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700">{error}</p>
      )}

      <p className="text-center text-[15px] font-medium leading-relaxed text-black">
        已有账号？{" "}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-[#0f3dde] transition-colors duration-200 hover:text-[#0c35c0] focus:ring-2 focus:ring-[#0f3dde]/20 rounded-xs focus:outline-hidden cursor-pointer"
        >
          登录
        </button>
      </p>
    </form>
  );
}
