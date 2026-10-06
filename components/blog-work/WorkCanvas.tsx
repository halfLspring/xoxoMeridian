"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HomePhotoElement } from "@/components/home/HomePhotoElement";
import { PostCardView } from "@/components/blog/PostCardView";
import { CanvasConnection } from "@/components/home/CanvasConnection";
import type { HomePhotoElementData } from "@/components/home/types";
import type { WorkSnapshot, WorkElement } from "@/lib/blog-work/types";
import { sceneToScreen, visibleAnchor, windowRect, type Point, type Rect } from "@/lib/blog-work/geometry";

export type AnchorRegistrar = (id: string, point: () => Point | null) => () => void;
const ignoreAnchor = () => () => {};
export function WorkCanvas({ work, scale, editing, disabled = false, openDisabled = false, onPhotoPreview, onPhotoCommit, onDeletePhoto, onPost, onSelect, selected, registerAnchor }: {
  work: WorkSnapshot; scale: number; editing: boolean; disabled?: boolean; openDisabled?: boolean;
  onPhotoPreview: (id: string, patch: Partial<WorkElement>) => void;
  onPhotoCommit: (id: string, patch: Partial<WorkElement>) => void;
  onDeletePhoto: (id: string) => void; onPost: (id: string) => void; onSelect: (id: string) => void;
  selected?: string | null; registerAnchor?: AnchorRegistrar;
}) {
  const stage = useRef<HTMLDivElement>(null), postNodes = useRef(new Map<string, HTMLDivElement>());
  const measuredHeights = useRef<Record<string, number>>({});
  const [heights, setHeights] = useState<Record<string, number>>({});
  const positions = useMemo(() => {
    let y = 72;
    const result = new Map<string, Rect>();
    for (const post of work.posts) { const rect = { x: Math.max(24, work.layoutWidth / 2 - 384), y, width: 352, height: heights[post.id] ?? 180 }; result.set(post.elementId, rect); y += rect.height + 32; }
    return result;
  }, [work.posts, work.layoutWidth, heights]);
  const postIds = work.posts.map(post => post.id).join(",");
  useLayoutEffect(() => {
    const measure = () => {
      const next = Object.fromEntries([...postNodes.current].map(([id, node]) => [id, node.offsetHeight]));
      if (JSON.stringify(measuredHeights.current) === JSON.stringify(next)) return;
      measuredHeights.current = next;
      setHeights(next);
    };
    const observer = new ResizeObserver(measure); postNodes.current.forEach(node => observer.observe(node)); measure();
    return () => observer.disconnect();
  }, [postIds]);
  const rectFor = useCallback((element: WorkElement): Rect => element.type === "note" ? positions.get(element.id) ?? { x: 0, y: 0, width: 0, height: 0 } : element, [positions]);
  const live = useRef({ work, scale, rectFor });
  useLayoutEffect(() => { live.current = { work, scale, rectFor }; }, [work, scale, rectFor]);
  const elementIds = work.elements.map(element => element.id).join(",");
  useEffect(() => {
    if (!registerAnchor) return;
    const removers = elementIds.split(",").filter(Boolean).map(elementId => registerAnchor(elementId, () => {
      const { work: current, scale: currentScale, rectFor: getRect } = live.current;
      const e = current.elements.find(item => item.id === elementId), origin = stage.current?.getBoundingClientRect();
      if (!e || !origin) return null;
      const anchor = visibleAnchor(getRect(e), e.rotation, [windowRect(current)]);
      return anchor ? sceneToScreen(anchor, { x: origin.left, y: origin.top }, { x: current.viewportX, y: current.viewportY }, currentScale) : null;
    }));
    return () => removers.forEach(remove => remove());
  }, [registerAnchor, elementIds]);
  const anchors = new Map(work.elements.map(e => [e.id, visibleAnchor(rectFor(e), e.rotation, [windowRect(work)])]));
  return <div ref={stage} className="work-crop" style={{ width: work.viewportWidth * scale, height: work.viewportHeight * scale }}>
    <div className="work-scene" style={{ width: work.viewportWidth, height: work.viewportHeight, transform: `scale(${scale})`, transformOrigin: "top left" }}>
      <div style={{ position: "absolute", transform: `translate(${-work.viewportX}px, ${-work.viewportY}px)` }}>
        {work.posts.map(post => {
          const rect = positions.get(post.elementId)!;
          return <div key={post.id} ref={node => { if (node) postNodes.current.set(post.id, node); else postNodes.current.delete(post.id); }} className="work-post" data-work-post={post.id} style={{ position: "absolute", left: rect.x, top: rect.y, width: 352 }}>
            <PostCardView title={post.title || "未命名博文"} content={post.content} authorName={work.ownerName}
              timestamp={post.publishedAt ?? work.updatedAt} authorTimezone={post.authorTimezone} authorCity={post.authorCity} authorCountry={post.authorCountry} draft={work.status === "draft"}
              onOpen={() => selected !== undefined && selected !== null ? onSelect(post.elementId) : onPost(post.id)}
              openDisabled={openDisabled}
              actions={<>
                {/* 保留操作行高度，切换编辑状态不移动后续卡片和连线锚点。 */}
                <div className="mt-3 flex h-4 gap-2">
                  {editing && work.canManage && <button type="button" className="post-card-edit" disabled={disabled} onClick={() => onPost(post.id)}>Edit</button>}
                </div>
                {editing && <button type="button" className="work-post-link" onClick={() => onSelect(post.elementId)}>选择为连线端点</button>}
              </>}
            />
          </div>;
        })}
        {work.elements.filter(e => e.type === "photo" && e.imageUrl).map(element => <HomePhotoElement key={element.id} element={element as HomePhotoElementData} viewScale={scale} readOnly={!editing} deleting={disabled} selected={selected === element.id} onSelect={onSelect}
          onMove={(id, x, y) => onPhotoPreview(id, { x, y })} onMoveEnd={(id, x, y) => onPhotoCommit(id, { x, y })}
          onResizePreview={(id, width, height) => onPhotoPreview(id, { width, height })} onResizeEnd={(id, width, height) => onPhotoCommit(id, { width, height })}
          onRotate={(id, rotation) => onPhotoPreview(id, { rotation })} onRotateEnd={(id, rotation) => onPhotoCommit(id, { rotation })}
          onCaption={(id, caption) => onPhotoCommit(id, { caption })} onDelete={onDeletePhoto} registerAnchor={ignoreAnchor}
        />)}
      </div>
    </div>
    {/* SVG 留在缩放场景外；与普通画布、页面连线共用屏幕像素线宽及图钉。 */}
    <svg className="work-connections" aria-hidden="true" width={work.viewportWidth * scale} height={work.viewportHeight * scale}>
      {work.connections.map(connection => {
        const from = anchors.get(connection.fromId), to = anchors.get(connection.toId);
        if (!from || !to) return null;
        const viewport = { x: work.viewportX, y: work.viewportY };
        return <g key={connection.id} data-work-connection={connection.id}>
          <CanvasConnection from={sceneToScreen(from, { x: 0, y: 0 }, viewport, scale)} to={sceneToScreen(to, { x: 0, y: 0 }, viewport, scale)} color={connection.color} />
        </g>;
      })}
    </svg>
  </div>;
}
