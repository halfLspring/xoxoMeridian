"use client";

import { useBlogActions } from "@/components/blog-work/BlogActionProvider";
import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandBadge } from "@/components/layout/BrandBadge";
import { SearchInput } from "@/components/blog/SearchInput";

export function SiteNav({ currentUser }: { currentUser: { id: string; displayName: string; avatarLabel: string } }) {
  const pathname = usePathname();
  const blogActions = useBlogActions();
  const isHome = pathname === "/home";
  const isChat = pathname.startsWith("/chat");
  const isStudy = pathname.startsWith("/study");

  return (
    <nav className="sticky top-0 z-40 border-b border-[#e8e8e8] bg-white/95 backdrop-blur-sm">
      <div className="site-nav-content flex min-h-16 flex-wrap items-center justify-between gap-3 px-5 py-2">
        <div className="flex min-w-0 items-center gap-6">
          <BrandBadge />
          <Link
            href="/home"
            scroll={false}
            className={`text-xs font-medium transition-colors ${
              isHome ? "text-[#3a5b22]" : "text-black/50 hover:text-black"
            }`}
          >
            Blog
          </Link>
          <Link
            href="/chat"
            className={`text-xs font-medium transition-colors ${
              isChat ? "text-[#3a5b22]" : "text-black/50 hover:text-black"
            }`}
          >
            Chat
          </Link>
          <Link
            href="/study"
            className={`text-xs font-medium transition-colors ${
              isStudy ? "text-[#3a5b22]" : "text-black/50 hover:text-black"
            }`}
          >
            Study
          </Link>
        </div>
        <div className="site-nav-tools flex min-w-0 flex-wrap items-center gap-3">
          <Suspense fallback={<div className="w-48 h-[30px]" />}>
            <SearchInput />
          </Suspense>
          {!isStudy && <Link href="/home?draft=list" className="work-nav-button" onClick={event => { if (isHome && blogActions) { event.preventDefault(); blogActions.requestAction("list"); } }}>My Draft</Link>}
          {!isStudy && (
            <Link
              href="/posts/new"
              className="rounded-[10px] border border-[#d9d9d9] bg-white px-3 py-1.5 text-xs font-medium text-[#3a5b22] hover:bg-[#3a5b22] hover:text-white transition-colors"
            >
              New Post
            </Link>
          )}
          <Link
            href="/me"
            className="text-xs text-black/40 hover:text-black transition-colors"
          >
            {currentUser.displayName}
          </Link>
        </div>
      </div>
    </nav>
  );
}
