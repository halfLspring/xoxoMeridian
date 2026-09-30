import { Prisma } from "@prisma/client";

import { jsonOk, jsonError, errorToResponse } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import {
  getHomeBoardElementAccessWhere,
  getOrCreateHomeBoard,
} from "@/lib/home-board";
import { prisma } from "@/lib/prisma";
import { readJsonBody, homeBoardElementPatchSchema } from "@/lib/validation";
import { extractAtlasStorageKey, getAtlasStorage } from "@/lib/storage/atlas-storage";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ elementId: string }> }
) {
  try {
    const user = await requireCurrentUser();
    const board = await getOrCreateHomeBoard();
    const { elementId } = await params;
    const accessWhere = getHomeBoardElementAccessWhere({
      boardId: board.id,
      userId: user.id,
    });

    const element = await prisma.atlasElement.findFirst({
      where: { id: elementId, AND: [accessWhere] },
    });

    if (!element) {
      return jsonError("Element not found", 404);
    }

    const body = await readJsonBody(request, homeBoardElementPatchSchema);
    if (body.rotation !== undefined && (element.type !== "photo" || element.postId !== null)) {
      return jsonError("Only home photos can be rotated", 400);
    }
    const updated = await prisma.atlasElement.update({
      where: { id: elementId, AND: [accessWhere] },
      data: body,
    });

    return jsonOk({ element: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return jsonError("Element not found", 404);
    }
    return errorToResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ elementId: string }> }
) {
  try {
    const user = await requireCurrentUser();
    const board = await getOrCreateHomeBoard();
    const { elementId } = await params;
    const accessWhere = getHomeBoardElementAccessWhere({
      boardId: board.id,
      userId: user.id,
    });

    const element = await prisma.atlasElement.findFirst({
      where: { id: elementId, AND: [accessWhere] },
    });

    if (!element) {
      return jsonError("Element not found", 404);
    }

    if (element.postId) {
      return jsonError("Post anchors cannot be deleted from the home board", 400);
    }

    await prisma.atlasElement.delete({
      where: {
        id: elementId,
        AND: [accessWhere, { postId: null }],
      },
    });

    if (element.type === "photo" && element.imageUrl) {
      const key = extractAtlasStorageKey(element.imageUrl);
      if (key) await getAtlasStorage().delete(key).catch(() => {});
    }

    return jsonOk({ deleted: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return jsonError("Element not found", 404);
    }
    return errorToResponse(error);
  }
}
