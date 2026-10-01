import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeForgedImageFile,
  makeImageFile,
  MINIMAL_JPEG,
  MINIMAL_WEBP,
} from "@/tests/fixtures/image-bytes";

const mockUser = { id: "user-1" };
const mockBoard = { id: "board-1" };

const mockStorage = {
  save: vi.fn(),
  read: vi.fn(),
  delete: vi.fn(),
};

const mockPrisma = {
  blogMediaAsset: { findUnique: vi.fn() },
  atlasElement: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  atlasConnection: {
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(async () => mockUser),
}));

vi.mock("@/lib/atlas-board", () => ({
  ATLAS_GLOBAL_BOARD_ID: "atlas-global-board",
  getOrCreateBoard: vi.fn(async () => mockBoard),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/storage/atlas-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/atlas-storage")>();
  return {
    ...actual,
    getAtlasStorage: vi.fn(() => mockStorage),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.blogMediaAsset.findUnique.mockResolvedValue(null);
  mockStorage.save.mockResolvedValue({
    key: "atlas/saved-photo.jpg",
    contentType: "image/jpeg",
    size: 10,
  });
  mockStorage.read.mockResolvedValue({
    body: Buffer.from("image-bytes"),
    contentType: "image/webp",
  });
  mockStorage.delete.mockResolvedValue(undefined);
  mockPrisma.atlasElement.count.mockResolvedValue(0);
  mockPrisma.atlasElement.create.mockImplementation(async ({ data }) => ({
    id: "element-1",
    ...data,
  }));
  mockPrisma.atlasElement.findMany.mockResolvedValue([]);
  mockPrisma.atlasElement.findFirst.mockResolvedValue(null);
  mockPrisma.atlasElement.findUnique.mockResolvedValue(null);
  mockPrisma.atlasElement.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.atlasElement.delete.mockResolvedValue({});
  mockPrisma.atlasElement.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.atlasConnection.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.$transaction.mockImplementation(async (operations) => Promise.all(operations));
});

describe("atlas upload storage routes", () => {
  it("saves uploaded images through storage and stores an internal image URL", async () => {
    const { POST } = await import("@/app/api/atlas/uploads/route");
    const formData = new FormData();
    formData.set("file", makeImageFile(MINIMAL_JPEG, "photo.tmp", "image/jpeg"));
    formData.set("x", "12");
    formData.set("y", "34");
    formData.set("caption", "hello");

    const response = await POST(new Request("http://localhost/api/atlas/uploads", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mockStorage.save).toHaveBeenCalledTimes(1);
    expect(mockStorage.save).toHaveBeenCalledWith({
      originalName: "photo.tmp",
      mimeType: "image/jpeg",
      buffer: expect.any(Buffer),
    });
    expect(mockPrisma.atlasElement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        boardId: "board-1",
        type: "photo",
        x: 12,
        y: 34,
        imageUrl: "/api/atlas/uploads/atlas%2Fsaved-photo.jpg",
        caption: "hello",
        createdById: "user-1",
      }),
    });
    expect(payload.element.imageUrl).toBe("/api/atlas/uploads/atlas%2Fsaved-photo.jpg");
  });

  it("rejects an upload whose declared image MIME does not match its bytes", async () => {
    const { POST } = await import("@/app/api/atlas/uploads/route");
    const formData = new FormData();
    formData.set("file", makeForgedImageFile("payload.png", "image/png"));
    formData.set("x", "0");
    formData.set("y", "0");

    const response = await POST(new Request("http://localhost/api/atlas/uploads", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Unsupported image content (expected JPEG, PNG or WebP)");
    expect(mockStorage.save).not.toHaveBeenCalled();
    expect(mockPrisma.atlasElement.create).not.toHaveBeenCalled();
  });

  it("stores the image format detected from the bytes rather than the declared MIME", async () => {
    const { POST } = await import("@/app/api/atlas/uploads/route");
    const formData = new FormData();
    formData.set("file", makeImageFile(MINIMAL_WEBP, "renamed.jpg", "image/jpeg"));
    formData.set("x", "0");
    formData.set("y", "0");

    const response = await POST(new Request("http://localhost/api/atlas/uploads", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(201);
    expect(mockStorage.save).toHaveBeenCalledWith({
      originalName: "renamed.jpg",
      mimeType: "image/webp",
      buffer: expect.any(Buffer),
    });
  });

  it("returns 400 instead of crashing when the caption field is not text", async () => {
    const { POST } = await import("@/app/api/atlas/uploads/route");
    const formData = new FormData();
    formData.set("file", makeImageFile(MINIMAL_JPEG, "photo.jpg", "image/jpeg"));
    formData.set("caption", new File(["caption"], "caption.txt", { type: "text/plain" }));

    const response = await POST(new Request("http://localhost/api/atlas/uploads", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Caption must be text");
    expect(mockStorage.save).not.toHaveBeenCalled();
    expect(mockPrisma.atlasElement.create).not.toHaveBeenCalled();
  });

  it("rejects non-finite and non-numeric coordinates", async () => {
    const { POST } = await import("@/app/api/atlas/uploads/route");

    for (const [field, value] of [
      ["x", "Infinity"],
      ["y", "NaN"],
      ["x", "-Infinity"],
    ] as const) {
      vi.clearAllMocks();
  mockPrisma.blogMediaAsset.findUnique.mockResolvedValue(null);
      mockPrisma.atlasElement.count.mockResolvedValue(0);
      const formData = new FormData();
      formData.set("file", makeImageFile(MINIMAL_JPEG, "photo.jpg", "image/jpeg"));
      formData.set(field, value);

      const response = await POST(new Request("http://localhost/api/atlas/uploads", {
        method: "POST",
        body: formData,
      }));
      const payload = await response.json();

      expect(response.status, `${field}=${value}`).toBe(400);
      expect(payload.error, `${field}=${value}`).toBe(`${field} must be a number`);
      expect(mockStorage.save, `${field}=${value}`).not.toHaveBeenCalled();
      expect(mockPrisma.atlasElement.create, `${field}=${value}`).not.toHaveBeenCalled();
    }
  });

  it("rejects captions longer than the upload contract allows", async () => {
    const { POST } = await import("@/app/api/atlas/uploads/route");
    const formData = new FormData();
    formData.set("file", makeImageFile(MINIMAL_JPEG, "photo.jpg", "image/jpeg"));
    formData.set("caption", "x".repeat(201));

    const response = await POST(new Request("http://localhost/api/atlas/uploads", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Caption must be 200 characters or fewer");
    expect(mockStorage.save).not.toHaveBeenCalled();
    expect(mockPrisma.atlasElement.create).not.toHaveBeenCalled();
  });

  it("normalizes caption whitespace the same way the home board does", async () => {
    const { POST } = await import("@/app/api/atlas/uploads/route");

    for (const [caption, stored] of [
      ["   ", null],
      ["  linen  ", "linen"],
      ["", null],
    ] as const) {
      vi.clearAllMocks();
  mockPrisma.blogMediaAsset.findUnique.mockResolvedValue(null);
      mockPrisma.atlasElement.count.mockResolvedValue(0);
      mockStorage.save.mockResolvedValue({
        key: "atlas/saved-photo.jpg",
        contentType: "image/jpeg",
        size: 22,
      });
      mockPrisma.atlasElement.create.mockImplementation(async ({ data }) => ({
        id: "element-1",
        ...data,
      }));
      const formData = new FormData();
      formData.set("file", makeImageFile(MINIMAL_JPEG, "photo.jpg", "image/jpeg"));
      formData.set("caption", caption);

      const response = await POST(new Request("http://localhost/api/atlas/uploads", {
        method: "POST",
        body: formData,
      }));

      expect(response.status, `caption=${JSON.stringify(caption)}`).toBe(201);
      expect(mockPrisma.atlasElement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ caption: stored }),
      });
    }
  });

  it("reads referenced image bytes with identity-bound no-store headers", async () => {
    mockPrisma.atlasElement.findFirst.mockResolvedValue({ id: "legacy-photo" });
    const { GET } = await import("@/app/api/atlas/uploads/[filename]/route");

    const response = await GET(new Request("http://localhost/api/atlas/uploads/atlas%2Fimage.webp"), {
      params: Promise.resolve({ filename: "atlas%2Fimage.webp" }),
    });

    expect(response.status).toBe(200);
    expect(mockStorage.read).toHaveBeenCalledWith("atlas/image.webp");
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
    expect(response.headers.get("Content-Length")).toBe("11");
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe("image-bytes");
  });

  it("returns 404 when storage cannot find an uploaded image", async () => {
    mockPrisma.atlasElement.findFirst.mockResolvedValue({ id: "legacy-photo" });
    mockStorage.read.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
    const { GET } = await import("@/app/api/atlas/uploads/[filename]/route");

    const response = await GET(new Request("http://localhost/api/atlas/uploads/atlas%2Fmissing.jpg"), {
      params: Promise.resolve({ filename: "atlas%2Fmissing.jpg" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 for uploaded image keys outside the local storage boundary", async () => {
    mockStorage.read.mockRejectedValueOnce(new Error("Invalid atlas storage key: other/file.jpg"));
    const { GET } = await import("@/app/api/atlas/uploads/[filename]/route");

    const response = await GET(new Request("http://localhost/api/atlas/uploads/other%2Ffile.jpg"), {
      params: Promise.resolve({ filename: "other%2Ffile.jpg" }),
    });

    expect(response.status).toBe(404);
  });

  it("clears board records before best-effort storage cleanup", async () => {
    mockPrisma.atlasElement.findMany.mockResolvedValue([
      { imageUrl: "/api/atlas/uploads/atlas%2Fone.jpg" },
      { imageUrl: "https://evil.example/api/atlas/uploads/atlas%2Fskip.jpg" },
    ]);
    mockPrisma.$transaction.mockImplementationOnce(async (operations) => {
      expect(mockStorage.delete).not.toHaveBeenCalled();
      return Promise.all(operations);
    });
    const { DELETE } = await import("@/app/api/atlas/route");

    const response = await DELETE(new Request("http://localhost/api/atlas", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockStorage.delete).toHaveBeenCalledTimes(1);
    expect(mockStorage.delete).toHaveBeenCalledWith("atlas/one.jpg");
  });

  it("deletes an element record before best-effort storage cleanup", async () => {
    mockPrisma.atlasElement.findFirst.mockResolvedValueOnce({
      id: "element-1",
      type: "photo",
      imageUrl: "/api/atlas/uploads/atlas%2Fphoto.jpg",
    });
    mockPrisma.atlasElement.deleteMany.mockImplementationOnce(async () => {
      expect(mockStorage.delete).not.toHaveBeenCalled();
      return { count: 1 };
    });
    const { DELETE } = await import("@/app/api/atlas/elements/[elementId]/route");

    const response = await DELETE(
      new Request("http://localhost/api/atlas/elements/element-1", { method: "DELETE" }),
      { params: Promise.resolve({ elementId: "element-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.atlasElement.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "element-1",
        boardId: "atlas-global-board",
        postId: null,
      },
    });
    expect(mockStorage.delete).toHaveBeenCalledTimes(1);
    expect(mockStorage.delete).toHaveBeenCalledWith("atlas/photo.jpg");
  });
});
