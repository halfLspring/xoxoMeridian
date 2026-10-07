"use client";
import { useEffect, useState } from "react";
import type { HomeAnchor } from "@/components/home/types";
import { visibleAnchor, type Point } from "@/lib/blog-work/geometry";
import { useCanvasConnections } from "@/components/home/CanvasConnectionProvider";
import type { WorkSnapshot } from "@/lib/blog-work/types";
import { CanvasConnection } from "@/components/home/CanvasConnection";
export function WorkPageConnections({ connections, anchors, legacy }: { connections: WorkSnapshot["connections"]; anchors: Map<string, () => Point | null>; legacy: Map<string, HomeAnchor> }) {
  const controls = useCanvasConnections();
  const [lines, setLines] = useState<Array<{ id: string; color: string; a: Point; b: Point }>>([]);
  useEffect(() => {
    let frame = 0;
    const point = (id: string) => {
      const registered = anchors.get(id);
      if (registered) return registered();
      const old = legacy.get(id), rect = old?.getRect();
      if (!rect) return null;
      if (old?.kind === "photo") {
        const node = document.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(id)}"]`);
        if (node) {
          const style = getComputedStyle(node), matrix = new DOMMatrixReadOnly(style.transform), rotation = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
          return visibleAnchor({ x: rect.left + rect.width / 2 - node.offsetWidth / 2, y: rect.top + rect.height / 2 - node.offsetHeight / 2, width: node.offsetWidth, height: node.offsetHeight }, rotation, [{ x: 0, y: -1000000, width: document.documentElement.clientWidth, height: 2000000 }]);
        }
      }
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const measure = () => {
      const next = connections.flatMap(connection => { const a = point(connection.fromId), b = point(connection.toId); return a && b ? [{ id: connection.id, color: connection.color, a, b }] : []; });
      setLines(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      if (connections.length) frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [connections, anchors, legacy]);
  const renderLines = (actions: boolean) => lines.map(({ id, color, a, b }, index) => {
    const connection = connections.find(item => item.id === id);
    const action = actions && connection ? controls?.deleteAction(connection, index) : undefined;
    if (actions && !action) return null;
    return <g key={id} data-external-connection={actions ? undefined : id} data-external-connection-action={actions ? id : undefined}>
      <CanvasConnection from={a} to={b} color={color} deleteAction={action} hitOnly={actions} />
    </g>;
  });
  return <>
    <svg className="work-page-connections work-page-connection-actions">{renderLines(true)}</svg>
    <svg className="work-page-connections" aria-hidden="true">{renderLines(false)}</svg>
  </>;
}
