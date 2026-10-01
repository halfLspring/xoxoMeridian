import { jsonOk, jsonError, errorToResponse } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOrCreateHomeBoard } from "@/lib/home-board";
import {
  AtlasImageValidationError,
  getAtlasStorage,
  makeAtlasImageUrl,
  validateAtlasImageContent,
  validateAtlasImageFile,
} from "@/lib/storage/atlas-storage";
import { clampPhotoSize } from "@/lib/home-spatial";
import {
  homeUploadFieldsSchema,
  parseBody,
  readFormFields,
  ValidationError,
} from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const board = await getOrCreateHomeBoard();

    const count = await prisma.atlasElement.count({ where: { boardId: board.id, workId: null } });
    if (count >= 300) {
      return jsonError("Home board element limit reached (300)", 400);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return jsonError("No file provided", 400);
    }

    // 先按声明值快速拒绝（含 5MB 上限），避免把注定失败的请求读进内存。
    validateAtlasImageFile(file);

    // 字段解析必须在读取字节与写存储之前：解析失败时不落 blob、不建记录。
    const fields = parseBody(
      homeUploadFieldsSchema,
      readFormFields(formData, ["x", "y", "caption", "width", "height"])
    );

    const buffer = Buffer.from(await file.arrayBuffer());
    // 声明 MIME 只是元数据，存储用按内容判定的格式，扩展名与回读 content type 才对得上。
    const contentType = validateAtlasImageContent(buffer);
    const saved = await getAtlasStorage().save({
      originalName: file.name,
      mimeType: contentType,
      buffer,
    });

    const aspectRatio = fields.width / fields.height;
    const size = clampPhotoSize({ width: fields.width, aspectRatio });

    const element = await prisma.atlasElement.create({
      data: {
        boardId: board.id,
        type: "photo",
        x: fields.x,
        y: fields.y,
        width: size.width,
        height: size.height,
        rotation: Math.random() * 4 - 2,
        imageUrl: makeAtlasImageUrl(saved.key),
        caption: fields.caption || null,
        createdById: user.id,
      },
    });

    return jsonOk({ element }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonError(error.issues[0]?.message ?? "Invalid request", 400);
    }
    if (error instanceof AtlasImageValidationError) {
      return jsonError(error.message, 400);
    }
    return errorToResponse(error);
  }
}
