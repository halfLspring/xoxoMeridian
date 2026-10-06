"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function SearchInput() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (pathname !== "/home") return null;

  const query = searchParams.get("q") ?? "";
  return (
    <SearchField
      key={query}
      initialQuery={query}
    />
  );
}

function SearchField({
  initialQuery,
}: {
  initialQuery: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState({ value: initialQuery, shouldSearch: false });
  const { value } = draft;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setDraft({ value: nextValue, shouldSearch: true });
  };

  const handleClear = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setDraft({ value: "", shouldSearch: false });
    router.replace("/home");
  };

  useEffect(() => {
    if (!draft.shouldSearch) return;

    // 创建和清理属于同一 effect；开发模式重放时也会恢复尚未提交的查询。
    const timeout = setTimeout(() => {
      setDraft((current) => current === draft ? { ...current, shouldSearch: false } : current);
      const trimmed = draft.value.trim();
      const params = new URLSearchParams(window.location.search);
      if (trimmed) {
        params.set("q", trimmed);
      } else {
        params.delete("q");
      }
      const queryString = params.toString();
      router.replace(`/home${queryString ? `?${queryString}` : ""}`);
    }, 300);
    debounceRef.current = timeout;

    return () => {
      clearTimeout(timeout);
      if (debounceRef.current === timeout) debounceRef.current = null;
    };
  }, [draft, router]);

  return (
    <div className="relative flex items-center">
      <label htmlFor="home-post-search" className="sr-only">
        Search posts
      </label>
      <svg
        className="absolute left-2.5 h-3.5 w-3.5 text-black/30 pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        id="home-post-search"
        type="text"
        value={value}
        onChange={handleChange}
        placeholder="Search posts..."
        className="w-48 rounded-[10px] border border-[#d9d9d9] bg-white pl-8 pr-7 py-1.5 text-xs text-black placeholder:text-black/30 focus:outline-hidden focus:border-[#3a5b22] focus:w-56 transition-all duration-200"
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 flex items-center justify-center h-3.5 w-3.5 rounded-full text-black/30 hover:text-black/60 transition-colors"
          aria-label="Clear search"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
