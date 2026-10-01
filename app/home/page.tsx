import { Suspense } from "react";
import { requirePageUser } from "@/lib/auth";
import { queryBlogFeed } from "@/lib/blog-work/feed";
import { SiteNav } from "@/components/blog/SiteNav";
import { BlogActionProvider } from "@/components/blog-work/BlogActionProvider";
import { PageTransition } from "@/components/layout/PageTransition";
import { ScrollRestore } from "@/components/layout/ScrollRestore";
import { HomeTimelineBoard } from "@/components/home/HomeTimelineBoard";
import { ensureHomePostElements, getHomeBoardSnapshot, getOrCreateHomeBoard } from "@/lib/home-board";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requirePageUser();

  const feed = await queryBlogFeed(user.id);
  const timelinePosts = feed.entries.flatMap(entry => entry.kind === "post" ? [entry.post] : []);

  const board = await getOrCreateHomeBoard();
  await ensureHomePostElements({
    boardId: board.id,
    posts: timelinePosts.map((post) => ({ id: post.id, authorId: post.authorId })),
  });
  const initialSnapshot = await getHomeBoardSnapshot({
    boardId: board.id,
    userId: user.id,
  });

  // 越界空间元素的裁切语义由 globals.css 的 .home-linen-page 承担（overflow: hidden 会让
  // sticky 的 SiteNav 相对这个不可滚动的容器解析、随文档滚走，故改用 overflow: clip）。
  return (
    <div className="home-linen-page min-h-screen relative">
      <div
        className="fixed top-[-20%] left-[-10%] w-[40vw] h-[40vw] rounded-full bg-sage-100/40 blur-3xl pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="fixed bottom-[-15%] right-[-8%] w-[35vw] h-[35vw] rounded-full bg-sage-200/30 blur-3xl pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="fixed top-[40%] left-[60%] w-[25vw] h-[25vw] rounded-full bg-skysoft-100/20 blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      <ScrollRestore storageKey="home-timeline" />
      <BlogActionProvider key={user.id}>
        <SiteNav currentUser={user} />
        <PageTransition>
          <Suspense fallback={null}>
            <HomeTimelineBoard
              key={user.id}
              posts={JSON.parse(JSON.stringify(timelinePosts))}
              feed={JSON.parse(JSON.stringify(feed))}
              currentUserId={user.id}
              initialSnapshot={JSON.parse(JSON.stringify(initialSnapshot))}
            />
          </Suspense>
        </PageTransition>
      </BlogActionProvider>
    </div>
  );
}
