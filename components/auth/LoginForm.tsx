"use client";

import { useState } from "react";

import { PasswordInput } from "@/components/auth/PasswordInput";

export function LoginForm({ onSwitchToRegister }: { onSwitchToRegister: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "登录失败");
        setSubmitting(false);
        return;
      }

      const payload = (await response.json().catch(() => null)) as {
        user?: { id: string };
      } | null;

      // Verify the session cookie actually persisted before navigating. If
      // APP_BASE_URL is https but the client accessed via http, browsers drop
      // the Secure cookie silently — without this probe the user would just
      // see /chat bounce them back to /, looking like a no-op login.
      const expectedUserId = payload?.user?.id;
      const probe = await fetch(
        expectedUserId ? `/api/auth/me?expect=${encodeURIComponent(expectedUserId)}` : "/api/auth/me",
        { cache: "no-store", credentials: "same-origin" }
      );
      if (!probe.ok) {
        setError(
          "登录已通过验证，但浏览器没有切换到该账号。请清理旧登录 Cookie 后重试。"
        );
        setSubmitting(false);
        return;
      }

      window.location.replace(`/home`);
    } catch {
      setError("登录请求失败，请稍后重试。");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-email" className="text-[15px] font-medium leading-none text-black">邮箱</label>
        <input
          id="login-email"
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

      <div className="relative flex flex-col gap-1.5">
        <label htmlFor="login-password" className="text-[15px] font-medium leading-none text-black">密码</label>
        <PasswordInput
          id="login-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="输入密码"
          autoComplete="current-password"
          required
          disabled={submitting}
        />
        <a
          href="/forgot-password"
          className="absolute right-0 top-0 text-xs font-medium text-[#0c2a92] transition-colors duration-200 hover:text-[#0a2380] cursor-pointer"
        >
          忘记密码？
        </a>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="mt-1 w-full min-h-[44px] rounded-[10px] bg-[#3a5b22] px-4 py-3 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[#2e4a1a] focus:ring-2 focus:ring-[#3a5b22]/30 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        {submitting ? "登录中…" : "登录"}
      </button>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700">{error}</p>
      )}

      <p className="text-center text-[15px] font-medium leading-relaxed text-black">
        还没有账号？{" "}
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="text-[#0f3dde] transition-colors duration-200 hover:text-[#0c35c0] focus:ring-2 focus:ring-[#0f3dde]/20 rounded-xs focus:outline-hidden cursor-pointer"
        >
          注册
        </button>
      </p>
    </form>
  );
}
