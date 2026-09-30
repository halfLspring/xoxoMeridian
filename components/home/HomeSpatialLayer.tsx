"use client";

import type { AtlasConnectionData } from "@/components/atlas/types";
import { HomeConnectionLayer } from "@/components/home/HomeConnectionLayer";
import { HomeContextMenu } from "@/components/home/HomeContextMenu";
import { HomePhotoElement } from "@/components/home/HomePhotoElement";
import type { HomeAnchor, HomeContextMenuState, HomePhotoElementData } from "@/components/home/types";

export function HomeSpatialLayer({
  boardRect,
  anchors,
  photos,
  connections,
  deletingPhotoIds,
  deletingConnectionIds,
  connectFromId,
  contextMenu,
  onSelectElement,
  onMovePhoto,
  onMovePhotoEnd,
  onResizePhotoEnd,
  onRotatePhoto,
  onRotatePhotoEnd,
  onCaptionPhoto,
  onDeletePhoto,
  onDeleteConnection,
  onAddPhotoFromMenu,
  registerPhotoAnchor,
}: {
  boardRect: DOMRect | null;
  anchors: Map<string, HomeAnchor>;
  photos: HomePhotoElementData[];
  connections: AtlasConnectionData[];
  deletingPhotoIds: string[];
  deletingConnectionIds: string[];
  connectFromId: string | null;
  contextMenu: HomeContextMenuState | null;
  onSelectElement: (id: string) => void;
  onMovePhoto: (id: string, x: number, y: number) => void;
  onMovePhotoEnd: (id: string, x: number, y: number) => void;
  onResizePhotoEnd: (id: string, width: number, height: number) => void;
  onRotatePhoto: (id: string, rotation: number) => void;
  onRotatePhotoEnd: (id: string, rotation: number) => void;
  onCaptionPhoto: (id: string, caption: string) => void;
  onDeletePhoto: (id: string) => void;
  onDeleteConnection: (id: string) => void;
  onAddPhotoFromMenu: () => void;
  registerPhotoAnchor: (id: string, getRect: () => DOMRect | null) => () => void;
}) {
  return (
    <>
      <div className="home-photo-layer" aria-hidden={false}>
        {photos.map((photo) => (
          <HomePhotoElement
            key={photo.id}
            element={photo}
            deleting={deletingPhotoIds.includes(photo.id)}
            selected={connectFromId === photo.id}
            onSelect={onSelectElement}
            onMove={onMovePhoto}
            onMoveEnd={onMovePhotoEnd}
            onResizeEnd={onResizePhotoEnd}
            onRotate={onRotatePhoto}
            onRotateEnd={onRotatePhotoEnd}
            onCaption={onCaptionPhoto}
            onDelete={onDeletePhoto}
            registerAnchor={registerPhotoAnchor}
          />
        ))}
      </div>

      <HomeConnectionLayer
        boardRect={boardRect}
        anchors={anchors}
        connections={connections}
        deletingIds={deletingConnectionIds}
        onDelete={onDeleteConnection}
      />

      {contextMenu && (
        <HomeContextMenu
          state={contextMenu}
          onAddPhoto={onAddPhotoFromMenu}
        />
      )}
    </>
  );
}
