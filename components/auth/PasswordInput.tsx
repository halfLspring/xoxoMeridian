"use client";

import { useState } from "react";

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={show ? "text" : "password"}
        className={`w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 pr-10 text-[15px] font-medium leading-normal text-black placeholder:text-[#b0b0b0] placeholder:text-sm transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden disabled:cursor-not-allowed disabled:bg-neutral-50 ${props.className ?? ""}`}
      />
      <button
        type="button"
        aria-label={show ? "隐藏密码" : "显示密码"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-black/25 transition-colors duration-200 hover:text-black/50 focus:outline-hidden cursor-pointer"
        onClick={() => setShow((v) => !v)}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
