"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Floating back-to-blog trigger. Appears after the user scrolls past the
 * article header, offering a quick way back to the timeline without losing
 * scroll position (coordinated via useScrollMemory on the /home page).
 *
 * Swiss Modernism 2.0 styling: clean grid, minimal adornment, mathematical
 * proportions. The BrandBadge on the left + Blog link in SiteNav already
 * provide the persistent route home; this is the ergonomic shortcut for
 * readers who've scrolled deep into a post.
 */
export function BackToBlog() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > 200);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <Link
      href="/home"
      scroll={false}
      className={`fixed left-6 bottom-8 z-30 inline-flex items-center gap-2 rounded-full border border-[#e8e8e8] bg-white/95 px-4 py-2.5 text-sm font-medium text-[#3F3F46] shadow-xs backdrop-blur-xs transition-all duration-300 hover:border-[#d0d0d0] hover:text-[#18181B] hover:shadow-md ${
        visible
          ? "translate-y-0 opacity-100 pointer-events-auto"
          : "translate-y-4 opacity-0 pointer-events-none"
      }`}
      aria-label="返回博客列表"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      <span className="hidden sm:inline">Back to Blog</span>
    </Link>
  );
}
