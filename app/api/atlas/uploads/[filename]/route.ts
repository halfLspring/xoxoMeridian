import { assertAssetRead } from "@/lib/blog-work/assets";
import { WorkError } from "@/lib/blog-work/policy";
import { noStoreResponse } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import type { AtlasStorageReadResult } from "@/lib/storage/atlas-storage";
import { getAtlasStorage, isAtlasStorageNotFoundError } from "@/lib/storage/atlas-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const user = await requireCurrentUser();
    const { filename } = await params;

    let key: string;
    try {
      key = decodeURIComponent(filename);
    } catch {
      return noStoreResponse(new Response("Not found", { status: 404 }));
    }

    await assertAssetRead(key, user.id);
    let result: AtlasStorageReadResult;
    try {
      result = await getAtlasStorage().read(key);
    } catch (err: unknown) {
      if (isAtlasStorageNotFoundError(err)) {
        return noStoreResponse(new Response("Not found", { status: 404 }));
      }
      throw err;
    }

    const buffer = result.body;
    const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

    return noStoreResponse(new Response(body, {
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "private, no-store",
        "Content-Length": String(buffer.length),
        "Vary": "Cookie",
      },
    }));
  } catch (error) {
    if (error instanceof Response) return noStoreResponse(error);
    if (error instanceof WorkError) return noStoreResponse(new Response("Not found", { status: error.status }));
    return noStoreResponse(new Response("Internal error", { status: 500 }));
  }
}
