import type { Point } from "@/lib/blog-work/geometry";

function CanvasPin({ x, y }: Point) {
  return (
    <g className="canvas-connection-pin" style={{ pointerEvents: "none" }}>
      <circle cx={x + 1} cy={y + 2} r={5} fill="rgba(40,48,52,0.12)" />
      <circle cx={x} cy={y} r={5} fill="#dfead8" stroke="#668a5b" strokeWidth={1} />
      <circle cx={x - 1.5} cy={y - 1.5} r={1.6} fill="rgba(255,255,255,0.7)" />
    </g>
  );
}

// 坐标均为所在 SVG 的屏幕 CSS 像素；容器先完成场景缩放与原点换算。
export function CanvasConnection({ from, to, color, deleteAction }: {
  from: Point;
  to: Point;
  color?: string | null;
  deleteAction?: { label: string; disabled: boolean; onDelete: () => void };
}) {
  const sag = Math.min(Math.abs(to.x - from.x) * 0.22 + 18, 120);
  const path = `M ${from.x},${from.y} Q ${(from.x + to.x) / 2},${(from.y + to.y) / 2 + sag} ${to.x},${to.y}`;
  return (
    <g>
      {deleteAction && <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        role="button"
        tabIndex={0}
        aria-label={deleteAction.label}
        aria-disabled={deleteAction.disabled}
        className="focus-visible:stroke-sage-300/60 focus-visible:outline-hidden"
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
        onClick={event => {
          event.stopPropagation();
          if (!deleteAction.disabled) deleteAction.onDelete();
        }}
        onKeyDown={event => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          if (!deleteAction.disabled) deleteAction.onDelete();
        }}
      />}
      <path d={path} fill="none" stroke={color || "#668a5b"} strokeWidth={2} strokeLinecap="round" strokeDasharray="6 4" style={{ pointerEvents: "none" }} />
      <CanvasPin {...from} />
      <CanvasPin {...to} />
    </g>
  );
}
