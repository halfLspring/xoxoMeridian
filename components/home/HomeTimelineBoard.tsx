"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Timeline } from "@/components/blog/Timeline";
import type { TimelinePost } from "@/components/blog/Timeline";
import { HomeSpatialLayer } from "@/components/home/HomeSpatialLayer";
import { HomeUploadModal } from "@/components/home/HomeUploadModal";
import type { HomeAnchor, HomeBoardSnapshot, HomeContextMenuState, HomePhotoElementData } from "@/components/home/types";
import { useHomeBoardMutations } from "@/components/home/useHomeBoardMutations";
import { isHomeBlankTarget } from "@/lib/home-spatial";

export function HomeTimelineBoard({
  posts,
  currentUserId,
  initialSnapshot,
}: {
  posts: TimelinePost[];
  currentUserId: string;
  initialSnapshot: HomeBoardSnapshot;
}) {
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
  const [uploadPosition, setUploadPosition] = useState<{ x: number; y: number } | null>(null);

  // Search state
  const searchParams = useSearchParams();
  const q = searchParams.get("q")?.trim() ?? "";
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [searchState, setSearchState] = useState<{
    query: string;
    attempt: number;
    posts: TimelinePost[] | null;
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
        error,
      }));
    };

    fetch(`/api/posts?q=${encodeURIComponent(q)}&limit=50`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          fail(response.status === 401
            ? "登录已失效，请重新登录后重试搜索。"
            : "搜索失败，请重试。");
          return;
        }
        const data = await response.json();
        if (!data || !Array.isArray(data.posts)) {
          fail("搜索失败，请重试。");
          return;
        }
        // 取消不能撤回已交付的响应；每次请求也必须在写入状态前确认仍有效。
        if (controller.signal.aborted) return;
        setSearchState({ query: q, attempt: searchAttempt, posts: data.posts, error: null });
      })
      .catch(() => fail("搜索失败，请重试。"));

    return () => {
      controller.abort();
    };
  }, [q, searchAttempt]);

  const currentSearch = searchState?.query === q && searchState.attempt === searchAttempt ? searchState : null;
  const searchPending = !!q && !currentSearch;
  const searchError = q ? currentSearch?.error : null;
  const displayPosts = q ? (searchState?.posts ?? posts) : posts;
  const emptyMessage = q && currentSearch && !currentSearch.error && currentSearch.posts?.length === 0
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
      onContextMenu={(event) => {
        const target = event.target as HTMLElement;
        if (!isHomeBlankTarget(target)) return;
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

      <main className="relative z-20 mx-auto max-w-3xl px-6 py-12">
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
        {!q || displayPosts.length > 0 || (!searchPending && !searchError) ? (
          <Timeline
            posts={displayPosts}
            currentUserId={currentUserId}
            postElementByPostId={postElementByPostId}
            connectFromId={connectFromId}
            onSpatialElementClick={selectElement}
            registerSpatialAnchor={registerAnchor}
            emptyMessage={emptyMessage}
          />
        ) : null}
      </main>

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
