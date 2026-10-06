"use client";

import { useState } from "react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    setSuccess(false);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "请求失败");
        setSubmitting(false);
        return;
      }

      setSuccess(true);
      setEmail("");
    } catch {
      setError("请求失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
          <p className="font-medium">邮件已发送</p>
          <p className="mt-1">
            如果该邮箱已注册，您将收到密码重置链接。请检查您的邮箱（包括垃圾邮件文件夹）。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSuccess(false)}
          className="w-full rounded-lg border border-warm-200 px-4 py-3 text-sm font-medium text-ink transition hover:bg-warm-100"
        >
          重新发送
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="forgot-password-email" className="sr-only">邮箱</label>
      <input
        id="forgot-password-email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="邮箱"
        autoComplete="email"
        required
        className="w-full rounded-lg border border-warm-200 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-sage-400 focus:outline-hidden"
        disabled={submitting}
      />
      <button
        type="submit"
        className="w-full rounded-lg bg-ink px-4 py-3 font-medium text-white transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={submitting}
      >
        {submitting ? "发送中…" : "发送重置链接"}
      </button>
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
