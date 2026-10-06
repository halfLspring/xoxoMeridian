"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BlogWorkspace } from "@/components/blog-work/BlogWorkspace";
import { useBlogActions } from "@/components/blog-work/BlogActionProvider";
import { WorkEditor } from "@/components/blog-work/WorkEditor";
import { WorkPageConnections } from "@/components/blog-work/WorkPageConnections";
import type { BlogFeed, WorkSnapshot } from "@/lib/blog-work/types";
import type { Point } from "@/lib/blog-work/geometry";
import { Timeline } from "@/components/blog/Timeline";
import type { TimelinePost } from "@/components/blog/Timeline";
import { HomeSpatialLayer } from "@/components/home/HomeSpatialLayer";
import { HomeUploadModal } from "@/components/home/HomeUploadModal";
import type { HomeAnchor, HomeBoardSnapshot, HomeContextMenuState, HomePhotoElementData } from "@/components/home/types";
import { useHomeBoardMutations } from "@/components/home/useHomeBoardMutations";
import { isHomeBlankTarget } from "@/lib/home-spatial";

export function HomeTimelineBoard({
  posts,
  feed,
  currentUserId,
  initialSnapshot,
}: {
  posts: TimelinePost[];
  feed?: BlogFeed;
  currentUserId: string;
  initialSnapshot: HomeBoardSnapshot;
}) {
  const [workAnchors, setWorkAnchors] = useState(() => new Map<string, () => Point | null>());
  const [activeWork, setActiveWork] = useState<WorkSnapshot | null>(null);
  const [publishedWorks, setPublishedWorks] = useState<WorkSnapshot[]>([]);
  const workPublished = useCallback((work: WorkSnapshot) => {
    setActiveWork(null);
    setPublishedWorks(previous => [...previous.filter(w => w.id !== work.id), work]);
  }, []);
  const [editedWorks, setEditedWorks] = useState<Record<string, WorkSnapshot>>({});
  const [deletedWorkIds, setDeletedWorkIds] = useState(() => new Set<string>());
  const workDeleted = useCallback((id: string) => {
    // 同步移除所有入口中的作品；迟到的搜索或分页响应也不能让它重新出现。
    setDeletedWorkIds(previous => new Set(previous).add(id));
    setActiveWork(previous => previous?.id === id ? null : previous);
    setPublishedWorks(previous => previous.filter(work => work.id !== id));
    setEditedWorks(previous => { const next = { ...previous }; delete next[id]; return next; });
  }, []);
  const registerWorkAnchor = useCallback((id: string, point: () => Point | null) => {
    setWorkAnchors(previous => new Map(previous).set(id, point));
    return () => setWorkAnchors(previous => { const next = new Map(previous); next.delete(id); return next; });
  }, []);
  const updatePublicWork = useCallback((work: WorkSnapshot) => setEditedWorks(previous => previous[work.id] === work ? previous : { ...previous, [work.id]: work }), []);
  const boardRef = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState(() => new Map<string, HomeAnchor>());
  const [boardRect, setBoardRect] = useState<DOMRect | null>(null);
  const {
    elements, setElements, connections, setConnections, saveStates,
    updatePhoto, savePhotoPatch, deletePhoto, deleteConnection, retry,
  } = useHomeBoardMutations(initialSnapshot);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextMenu, setContextMenu] = useState<HomeContextMenuState | null>(null);
  const blogIntent = useBlogActions()?.intent;
  const [uploadPosition, setUploadPosition] = useState<{ x: number; y: number } | null>(null);

  // Search state
  const searchParams = useSearchParams();
  const q = searchParams.get("q")?.trim() ?? "";
  const [extraPage, setExtraPage] = useState<{ query: string; entries: BlogFeed["entries"]; cursor: string | null } | null>(null);
  const [paging, setPaging] = useState(false), [pageError, setPageError] = useState("");
  const queryRef = useRef(q);
  useEffect(() => { queryRef.current = q; }, [q]);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [searchState, setSearchState] = useState<{
    query: string;
    attempt: number;
    posts: TimelinePost[] | null;
    works?: WorkSnapshot[];
    nextCursor?: string | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!q) return;

    const controller = new AbortController();
    const fail = (error: string) => {
      if (controller.signal.aborted) return;
      setSearchState((previous) => ({
        query: q,
        attempt: searchAttempt,
        posts: previous?.posts ?? null,
        works: previous?.works,
        nextCursor: previous?.nextCursor,
        error,
      }));
    };

    fetch(`${feed ? "/api/blog/feed" : "/api/posts"}?q=${encodeURIComponent(q)}&limit=50`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          fail(response.status === 401
            ? "登录已失效，请重新登录后重试搜索。"
            : "搜索失败，请重试。");
          return;
        }
        const data = await response.json();
        if (feed && Array.isArray(data.entries)) { data.posts = data.entries.filter((entry: { kind: string }) => entry.kind === "post").map((entry: { post: TimelinePost }) => entry.post); data.works = data.entries.filter((entry: { kind: string }) => entry.kind === "work").map((entry: { work: WorkSnapshot }) => entry.work); }
        if (!data || !Array.isArray(data.posts)) {
          fail("搜索失败，请重试。");
          return;
        }
        // 取消不能撤回已交付的响应；每次请求也必须在写入状态前确认仍有效。
        if (controller.signal.aborted) return;
        setSearchState({ query: q, attempt: searchAttempt, posts: data.posts, works: data.works, nextCursor: data.nextCursor, error: null });
      })
      .catch(() => fail("搜索失败，请重试。"));

    return () => {
      controller.abort();
    };
  }, [q, searchAttempt, feed]);

  const currentSearch = searchState?.query === q && searchState.attempt === searchAttempt ? searchState : null;
  const searchPending = !!q && !currentSearch;
  const searchError = q ? currentSearch?.error : null;
  const additional = extraPage?.query === q ? extraPage.entries : [];
  const displayPosts = [...new Map([...(q ? (searchState?.posts ?? posts) : posts), ...additional.flatMap(entry => entry.kind === "post" ? [entry.post] : [])].map(post => [post.id, post])).values()].filter(post => post.type !== "agent_log");
  const displayWorks = [...new Map([...(q ? [] : publishedWorks), ...((q ? searchState?.works : undefined) ?? feed?.entries.flatMap(entry => entry.kind === "work" ? [entry.work] : []) ?? []), ...additional.flatMap(entry => entry.kind === "work" ? [entry.work] : [])].map(work => [work.id, work])).values()].filter(work => !deletedWorkIds.has(work.id));
  const nextCursor = extraPage?.query === q ? extraPage.cursor : q ? currentSearch?.nextCursor : feed?.nextCursor;
  const externalConnections = [...new Map([...displayWorks.map(w => editedWorks[w.id] ?? w), ...(activeWork ? [activeWork] : [])].flatMap(w => w.connections.filter(c => !w.elements.some(e => e.id === c.fromId) || !w.elements.some(e => e.id === c.toId))).map(c => [c.id, c])).values()];
  const emptyMessage = q && currentSearch && !currentSearch.error && displayPosts.length === 0 && displayWorks.length === 0
    ? "No posts match your search."
    : undefined;

  const photos = useMemo(
    () => elements.filter((element): element is HomePhotoElementData => element.type === "photo" && !!element.imageUrl),
    [elements]
  );

  const postElementByPostId = useMemo(() => {
    const result: Record<string, string> = {};
    for (const element of elements) {
      if ("postId" in element && element.postId) {
        result[element.postId] = element.id;
      }
    }
    return result;
  }, [elements]);

  const refreshBoardRect = useCallback(() => {
    setBoardRect(boardRef.current?.getBoundingClientRect() ?? null);
  }, []);

  useEffect(() => {
    refreshBoardRect();
    window.addEventListener("resize", refreshBoardRect);
    window.addEventListener("scroll", refreshBoardRect, { passive: true });
    return () => {
      window.removeEventListener("resize", refreshBoardRect);
      window.removeEventListener("scroll", refreshBoardRect);
    };
  }, [refreshBoardRect]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("wheel", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("wheel", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!blogIntent) return;
    // 导航和菜单共用入口状态；键盘触发也需要关闭右键菜单。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContextMenu(null);
  }, [blogIntent]);

  const registerAnchor = useCallback((id: string, getRect: () => DOMRect | null) => {
    setAnchors((current) => {
      const next = new Map(current);
      next.set(id, { id, kind: "post", getRect });
      return next;
    });
    refreshBoardRect();
    return () => {
      setAnchors((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    };
  }, [refreshBoardRect]);

  const registerPhotoAnchor = useCallback((id: string, getRect: () => DOMRect | null) => {
    setAnchors((current) => {
      const next = new Map(current);
      next.set(id, { id, kind: "photo", getRect });
      return next;
    });
    refreshBoardRect();
    return () => {
      setAnchors((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    };
  }, [refreshBoardRect]);

  const selectElement = useCallback(async (id: string) => {
    if (!connectFromId) {
      setConnectFromId(id);
      if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
      connectTimerRef.current = setTimeout(() => {
        setConnectFromId(null);
        connectTimerRef.current = null;
      }, 1500);
      return;
    }

    if (connectFromId === id) {
      setConnectFromId(null);
      return;
    }

    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }

    const response = await fetch("/api/home-board/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromId: connectFromId, toId: id }),
    });

    if (response.ok) {
      const { connection } = await response.json();
      setConnections((prev) => [...prev, connection]);
    }

    setConnectFromId(null);
  }, [connectFromId, setConnections]);

  return (
    <div
      ref={boardRef}
      className="home-spatial-board relative"
      style={activeWork ? { minHeight: (activeWork.draftY ?? 40) + activeWork.viewportHeight * Math.min(1, (boardRect?.width ?? 960) / activeWork.viewportWidth) + 240 } : undefined}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement;
        if (!isHomeBlankTarget(target) || target.closest("[data-work-id]")) return;
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect) return;

        event.preventDefault();
        setContextMenu({
          screenX: event.clientX,
          screenY: event.clientY,
          boardX: event.clientX - rect.left,
          boardY: event.clientY - rect.top,
        });
      }}
    >
      <HomeSpatialLayer
        boardRect={boardRect}
        anchors={anchors}
        photos={photos}
        connections={connections}
        deletingPhotoIds={photos.filter((photo) => saveStates[`photo-delete:${photo.id}`]?.status === "saving").map((photo) => photo.id)}
        deletingConnectionIds={connections.filter((connection) => saveStates[`connection-delete:${connection.id}`]?.status === "saving").map((connection) => connection.id)}
        connectFromId={connectFromId}
        contextMenu={contextMenu}
        onSelectElement={selectElement}
        onMovePhoto={(id, x, y) => updatePhoto(id, { x, y })}
        onMovePhotoEnd={(id, x, y) => {
          savePhotoPatch(id, { x, y });
        }}
        onResizePhotoEnd={(id, width, height) => {
          savePhotoPatch(id, { width, height });
        }}
        onRotatePhoto={(id, rotation) => updatePhoto(id, { rotation })}
        onRotatePhotoEnd={(id, rotation) => {
          savePhotoPatch(id, { rotation });
        }}
        onCaptionPhoto={(id, caption) => {
          savePhotoPatch(id, { caption: caption.trim() });
        }}
        onDeletePhoto={deletePhoto}
        onDeleteConnection={deleteConnection}
        onAddPhotoFromMenu={() => {
          if (!contextMenu) return;
          setUploadPosition({ x: contextMenu.boardX, y: contextMenu.boardY });
          setContextMenu(null);
        }}
        registerPhotoAnchor={registerPhotoAnchor}
      />

      {Object.keys(saveStates).length > 0 ? (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
          {Object.entries(saveStates).map(([key, state]) => (
            <div
              key={key}
              className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 text-sm text-black/70 shadow-lg"
            >
              {state.status === "saving" ? (
                <span role="status">正在{state.action}{state.subject}…</span>
              ) : (
                <>
                  <span role="alert">{state.subject}{state.action}失败。</span>
                  <button
                    type="button"
                    className="rounded-md bg-sage-700 px-3 py-1.5 font-medium text-white hover:bg-sage-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-700"
                    aria-label={`重试${state.action}${state.subject}`}
                    onClick={() => retry(state)}
                  >
                    重试
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <main className="home-timeline-content relative z-20 mx-auto max-w-[1440px] px-6 py-12">
        {searchPending ? <p role="status" className="mb-6 text-sm text-black/60">正在搜索…</p> : null}
        {searchError ? (
          <div role="alert" className="mb-6 rounded-lg border border-black/10 bg-white p-4 text-sm text-black/70">
            <p>{searchError}</p>
            {displayPosts.length > 0 ? <p className="mt-1">仍显示上次成功加载的内容。</p> : null}
            <button
              type="button"
              className="mt-3 rounded-md bg-sage-700 px-3 py-1.5 font-medium text-white hover:bg-sage-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-700"
              onClick={() => setSearchAttempt((attempt) => attempt + 1)}
            >
              重试搜索
            </button>
          </div>
        ) : null}
        {!q || displayWorks.length > 0 || displayPosts.length > 0 || (!searchPending && !searchError) ? (
          <Timeline
            posts={displayPosts}
            works={displayWorks.filter(work => work.id !== activeWork?.id)}
            renderWork={work => <WorkEditor key={work.id} initial={work} actorId={currentUserId} onClose={() => {}} onPublished={() => {}} onDeleted={workDeleted} registerAnchor={registerWorkAnchor} onChanged={updatePublicWork} />}
            currentUserId={currentUserId}
            postElementByPostId={postElementByPostId}
            connectFromId={connectFromId}
            onSpatialElementClick={selectElement}
            registerSpatialAnchor={registerAnchor}
            emptyMessage={emptyMessage}
          />
        ) : null}
        {pageError && <p role="alert">{pageError}</p>}
        {nextCursor && <button type="button" className="work-nav-button mt-8" disabled={paging} onClick={async () => {
          setPaging(true); setPageError(""); const requestedQuery = q;
          try {
            const response = await fetch(`/api/blog/feed?limit=50&q=${encodeURIComponent(q)}&cursor=${encodeURIComponent(nextCursor)}`);
            if (!response.ok) throw new Error(); const data: BlogFeed = await response.json();
            if (queryRef.current !== requestedQuery) return;
            setExtraPage(previous => ({ query: q, entries: [...(previous?.query === q ? previous.entries : []), ...data.entries], cursor: data.nextCursor }));
          } catch { setPageError("加载更多失败，请重试"); } finally { setPaging(false); }
        }}>{paging ? "正在加载…" : "加载更早的作品"}</button>}
      </main>

      <BlogWorkspace actorId={currentUserId} registerAnchor={registerWorkAnchor} onDraftChange={setActiveWork} onPublished={workPublished} onDeleted={workDeleted} />
      <WorkPageConnections connections={externalConnections} anchors={workAnchors} legacy={anchors} />

      <HomeUploadModal
        isOpen={!!uploadPosition}
        position={uploadPosition}
        onClose={() => setUploadPosition(null)}
        onUploaded={(element) => {
          setElements((prev) => [...prev, element]);
          setUploadPosition(null);
        }}
      />
    </div>
  );
}
