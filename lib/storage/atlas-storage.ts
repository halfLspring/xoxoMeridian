import { randomUUID } from "node:crypto";
import { dirname, extname, resolve, sep } from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { env } from "@/lib/env";

const ATLAS_UPLOAD_ROUTE = "/api/atlas/uploads/";

export const ATLAS_ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const ATLAS_MAX_FILE_SIZE = 5 * 1024 * 1024;

export type AtlasImageFormat = "image/jpeg" | "image/png" | "image/webp";

/** 上传被拒时抛出的类型，路由据此稳定映射成 400，不再靠匹配错误文案。 */
export class AtlasImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtlasImageValidationError";
  }
}

export type AtlasStorageSaveInput = {
  key: string;
  body: Buffer;
  contentType: string;
};

export type AtlasStorageUploadInput = {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
};

export type AtlasStorageSaveResult = {
  key: string;
  contentType: string;
  size: number;
};

export type AtlasStorageReadResult = {
  body: Buffer;
  contentType: string;
};

export type AtlasStorage = {
  save(input: AtlasStorageSaveInput | AtlasStorageUploadInput): Promise<AtlasStorageSaveResult>;
  read(key: string): Promise<AtlasStorageReadResult>;
  delete(key: string): Promise<void>;
};

type AliyunOssClient = {
  put(
    key: string,
    body: Buffer,
    options?: { mime?: string; headers?: Record<string, string> }
  ): Promise<unknown>;
  get(key: string): Promise<{ content: Buffer; res?: { headers?: Record<string, string> } }>;
  delete(key: string): Promise<unknown>;
};

type AliyunOssConstructor = new (options: Record<string, string>) => AliyunOssClient;

function invalidAtlasStorageKey(key: string) {
  return new Error(`Invalid atlas storage key: ${key}`);
}

function extensionForAtlasMime(contentType: string | undefined): string | null {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

function extensionForOriginalName(originalName: string): string {
  const extension = extname(originalName).replace(/^\./, "").toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "jpg";
    case "png":
    case "webp":
      return extension;
    default:
      return "jpg";
  }
}

export function sanitizeAtlasBaseName(name: string): string {
  return name
    .replace(/[^\x00-\x7F]+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
}

export function normalizeAtlasPrefix(prefix: string): string {
  const normalized = prefix
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return normalized ? `${normalized}/` : "";
}

export function normalizeAtlasStorageKey(key: string, prefix = env.ALIYUN_OSS_PREFIX): string {
  const normalizedKey = key.trim();
  const normalizedPrefix = normalizeAtlasPrefix(prefix);

  if (
    !normalizedKey ||
    normalizedKey.startsWith("/") ||
    normalizedKey.includes("\\") ||
    normalizedKey.includes("..") ||
    normalizedKey.includes("%") ||
    (normalizedPrefix &&
      (!normalizedKey.startsWith(normalizedPrefix) || normalizedKey === normalizedPrefix))
  ) {
    throw invalidAtlasStorageKey(key);
  }

  return normalizedKey;
}

export function normalizeLocalAtlasStorageKey(
  key: string,
  prefix = env.ALIYUN_OSS_PREFIX
): string {
  const normalizedPrefix = normalizeAtlasPrefix(prefix);
  const normalizedKey = normalizeAtlasStorageKey(key, prefix);

  if (!normalizedPrefix && normalizedKey.includes("/")) {
    throw invalidAtlasStorageKey(key);
  }

  return normalizedKey;
}

export function makeAtlasObjectKey(
  originalName: string,
  prefix = env.ALIYUN_OSS_PREFIX,
  contentType?: string
): string {
  const extension = extensionForAtlasMime(contentType) ?? extensionForOriginalName(originalName);
  const baseName = originalName.replace(/\.[^.]+$/, "");
  const safeBaseName = sanitizeAtlasBaseName(baseName) || "image";

  return `${normalizeAtlasPrefix(prefix)}${randomUUID()}-${safeBaseName}.${extension}`;
}

export function contentTypeForKey(key: string): string {
  switch (extname(key).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function resolveAtlasSaveInput(
  input: AtlasStorageSaveInput | AtlasStorageUploadInput,
  prefix = env.ALIYUN_OSS_PREFIX
): AtlasStorageSaveInput {
  if ("originalName" in input) {
    return {
      key: makeAtlasObjectKey(input.originalName, prefix, input.mimeType),
      body: input.buffer,
      contentType: input.mimeType,
    };
  }

  return input;
}

export function makeAtlasImageUrl(key: string): string {
  return `${ATLAS_UPLOAD_ROUTE}${encodeURIComponent(key)}`;
}

export function extractAtlasStorageKey(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) {
    return null;
  }

  try {
    const normalizedUrl = imageUrl.trim();
    if (!normalizedUrl) {
      return null;
    }

    const appOrigin = new URL(env.APP_BASE_URL).origin;
    const url = new URL(normalizedUrl, env.APP_BASE_URL);
    if (url.origin !== appOrigin) {
      return null;
    }

    if (!url.pathname.startsWith(ATLAS_UPLOAD_ROUTE)) {
      return null;
    }

    const encodedKey = url.pathname.slice(ATLAS_UPLOAD_ROUTE.length);
    return normalizeAtlasStorageKey(decodeURIComponent(encodedKey));
  } catch {
    return null;
  }
}

export function isAtlasStorageNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  return (
    err.code === "ENOENT" ||
    err.code === "NoSuchKey" ||
    err.status === 404 ||
    err.statusCode === 404 ||
    (typeof err.message === "string" && err.message.startsWith("Invalid atlas storage key:"))
  );
}

export function createLocalAtlasStorage(
  uploadDir: string,
  prefix = env.ALIYUN_OSS_PREFIX
): AtlasStorage {
  const root = resolve(uploadDir);

  function filepathForKey(key: string) {
    const safeKey = normalizeLocalAtlasStorageKey(key, prefix);
    const filepath = resolve(root, safeKey);
    if (filepath === root || !filepath.startsWith(`${root}${sep}`)) {
      throw invalidAtlasStorageKey(key);
    }
    return { filepath, key: safeKey };
  }

  return {
    async save(input) {
      const resolved = resolveAtlasSaveInput(input, prefix);
      const { filepath, key } = filepathForKey(resolved.key);
      await mkdir(dirname(filepath), { recursive: true });
      await writeFile(filepath, resolved.body);

      return {
        key,
        contentType: resolved.contentType,
        size: resolved.body.length,
      };
    },

    async read(key) {
      const safeKey = filepathForKey(key);
      return {
        body: await readFile(safeKey.filepath),
        contentType: contentTypeForKey(safeKey.key),
      };
    },

    async delete(key) {
      const { filepath } = filepathForKey(key);
      try {
        await unlink(filepath);
      } catch (error) {
        if (!isAtlasStorageNotFoundError(error)) throw error;
      }
    },
  };
}

export function createAliyunOssAtlasStorage(): AtlasStorage {
  let clientPromise: Promise<AliyunOssClient> | undefined;

  function getClient() {
    clientPromise ??= import("ali-oss").then(({ default: OSS }) => {
      const OssClient = OSS as unknown as AliyunOssConstructor;
      return new OssClient({
        region: env.ALIYUN_OSS_REGION,
        bucket: env.ALIYUN_OSS_BUCKET,
        accessKeyId: env.ALIYUN_OSS_ACCESS_KEY_ID,
        accessKeySecret: env.ALIYUN_OSS_ACCESS_KEY_SECRET,
        ...(env.ALIYUN_OSS_ENDPOINT ? { endpoint: env.ALIYUN_OSS_ENDPOINT } : {}),
      });
    });

    return clientPromise;
  }

  return {
    async save(input) {
      const client = await getClient();
      const resolved = resolveAtlasSaveInput(input, env.ALIYUN_OSS_PREFIX);
      const key = normalizeAtlasStorageKey(resolved.key, env.ALIYUN_OSS_PREFIX);
      await client.put(key, resolved.body, {
        mime: resolved.contentType,
        headers: {
          "Content-Type": resolved.contentType,
          "Cache-Control": "private, no-store",
          "x-oss-object-acl": "private",
        },
      });

      return {
        key,
        contentType: resolved.contentType,
        size: resolved.body.length,
      };
    },

    async read(key) {
      const client = await getClient();
      const safeKey = normalizeAtlasStorageKey(key, env.ALIYUN_OSS_PREFIX);
      const result = await client.get(safeKey);
      return {
        body: result.content,
        contentType: result.res?.headers?.["content-type"] ?? contentTypeForKey(safeKey),
      };
    },

    async delete(key) {
      const client = await getClient();
      const safeKey = normalizeAtlasStorageKey(key, env.ALIYUN_OSS_PREFIX);
      try {
        await client.delete(safeKey);
      } catch (error) {
        if (!isAtlasStorageNotFoundError(error)) throw error;
      }
    },
  };
}

export function getAtlasStorage(): AtlasStorage {
  if (env.ATLAS_STORAGE_PROVIDER === "aliyun-oss") {
    return createAliyunOssAtlasStorage();
  }

  return createLocalAtlasStorage(env.ATLAS_UPLOAD_DIR);
}

export function validateAtlasImageFile(file: File): void {
  if (!ATLAS_ALLOWED_MIMES.has(file.type)) {
    throw new AtlasImageValidationError(`Unsupported file type: ${file.type}`);
  }

  if (file.size > ATLAS_MAX_FILE_SIZE) {
    throw new AtlasImageValidationError(
      `File too large: ${file.size} bytes (max ${ATLAS_MAX_FILE_SIZE})`
    );
  }
}

function isJpeg(buffer: Buffer) {
  // SOI + 段起始标记，且必须能找到 EOI 才算完整。
  return (
    buffer.length > 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    buffer.indexOf(Buffer.from([0xff, 0xd9]), 2) !== -1
  );
}

function isPng(buffer: Buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // 签名之后必须还有 IEND 数据块，避免「改了扩展名的文本」蒙混过关。
  return buffer.length > 8 && buffer.subarray(0, 8).equals(signature) && buffer.includes("IEND", 8, "latin1");
}

function isWebp(buffer: Buffer) {
  if (buffer.length < 16) {
    return false;
  }

  const isRiff = buffer.subarray(0, 4).toString("latin1") === "RIFF";
  const isWebpTag = buffer.subarray(8, 12).toString("latin1") === "WEBP";
  const chunkTag = buffer.subarray(12, 16).toString("latin1");
  const declaredSize = buffer.readUInt32LE(4);

  return (
    isRiff &&
    isWebpTag &&
    (chunkTag === "VP8 " || chunkTag === "VP8L" || chunkTag === "VP8X") &&
    // RIFF 头声明的长度覆盖不到实际字节数，说明文件被截断。
    declaredSize >= 12 &&
    declaredSize + 8 <= buffer.length
  );
}

/**
 * 按文件内容判定图片格式——客户端声明的 MIME 只是元数据，不可信。
 * 返回 null 表示字节不属于三种允许格式中的任何一种。
 */
export function detectAtlasImageFormat(buffer: Buffer): AtlasImageFormat | null {
  if (isJpeg(buffer)) {
    return "image/jpeg";
  }

  if (isPng(buffer)) {
    return "image/png";
  }

  if (isWebp(buffer)) {
    return "image/webp";
  }

  return null;
}

/** 校验字节确实是允许的三种图片之一，返回按内容判定的格式。 */
export function validateAtlasImageContent(buffer: Buffer): AtlasImageFormat {
  const format = detectAtlasImageFormat(buffer);

  if (!format) {
    throw new AtlasImageValidationError("Unsupported image content (expected JPEG, PNG or WebP)");
  }

  return format;
}
