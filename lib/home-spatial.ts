export type HomeSpatialKind = "post" | "photo";

export const HOME_PHOTO_MIN_WIDTH = 120;
export const HOME_PHOTO_MAX_WIDTH = 640;
export const HOME_PHOTO_INITIAL_MAX_WIDTH = 240;
export const HOME_PHOTO_INITIAL_MAX_HEIGHT = 240;
export const HOME_PHOTO_MAX_ROTATION = 25;

export function clampPhotoSize({
  width,
  aspectRatio,
}: {
  width: number;
  aspectRatio: number;
}) {
  const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 4 / 3;
  const clampedWidth = Math.max(HOME_PHOTO_MIN_WIDTH, Math.min(HOME_PHOTO_MAX_WIDTH, Math.round(width)));

  return {
    width: clampedWidth,
    height: Math.round(clampedWidth / safeAspectRatio),
  };
}

export function fitHomePhotoSizeToBounds({
  width,
  height,
  maxWidth = HOME_PHOTO_INITIAL_MAX_WIDTH,
  maxHeight = HOME_PHOTO_INITIAL_MAX_HEIGHT,
}: {
  width: number;
  height: number;
  maxWidth?: number;
  maxHeight?: number;
}) {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 320;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 240;
  const safeMaxWidth = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : HOME_PHOTO_INITIAL_MAX_WIDTH;
  const safeMaxHeight = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : HOME_PHOTO_INITIAL_MAX_HEIGHT;
  const scale = Math.min(safeMaxWidth / safeWidth, safeMaxHeight / safeHeight, 1);

  return clampPhotoSize({
    width: safeWidth * scale,
    aspectRatio: safeWidth / safeHeight,
  });
}

export function getRectCenter(
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  boardRect: Pick<DOMRect, "left" | "top">
) {
  return {
    x: rect.left - boardRect.left + rect.width / 2,
    y: rect.top - boardRect.top + rect.height / 2,
  };
}

export function isConnectablePair(from: HomeSpatialKind, to: HomeSpatialKind) {
  return !(from === "post" && to === "post");
}

export function isHomeBlankTarget(target: HTMLElement) {
  return !target.closest(
    [
      "a",
      "button",
      "input",
      "textarea",
      "select",
      "[contenteditable='true']",
      "[data-home-post-card]",
      "[data-home-photo]",
      "[data-home-context-menu]",
      "[data-caption-area]",
    ].join(",")
  );
}
