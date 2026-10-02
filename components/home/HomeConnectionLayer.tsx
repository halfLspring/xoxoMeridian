"use client";

import type { AtlasConnectionData } from "@/components/atlas/types";
import type { HomeAnchor } from "@/components/home/types";
import { getRectCenter } from "@/lib/home-spatial";
import { CanvasConnection } from "@/components/home/CanvasConnection";

export function HomeConnectionLayer({
  boardRect,
  anchors,
  connections,
  deletingIds,
  onDelete,
}: {
  boardRect: DOMRect | null;
  anchors: Map<string, HomeAnchor>;
  connections: AtlasConnectionData[];
  deletingIds: string[];
  onDelete: (id: string) => void;
}) {
  if (!boardRect) return null;

  return (
    <svg className="home-connection-layer">
      {connections.map((connection, index) => {
        const from = anchors.get(connection.fromId)?.getRect();
        const to = anchors.get(connection.toId)?.getRect();
        if (!from || !to) return null;

        const start = getRectCenter(from, boardRect);
        const end = getRectCenter(to, boardRect);
        return (
          <CanvasConnection key={connection.id} from={start} to={end} color={connection.color}
            deleteAction={{ label: `删除连线 ${index + 1}`, disabled: deletingIds.includes(connection.id), onDelete: () => onDelete(connection.id) }} />
        );
      })}
    </svg>
  );
}
