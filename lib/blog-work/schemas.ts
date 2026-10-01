import { z } from "zod";

// 客户端也使用窗口契约；禁用运行时函数生成以兼容现有 CSP。
z.config({ jitless: true });
export const workIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const coordinate = z.number().finite().min(-1000000).max(1000000);
export const windowSchema = z.strictObject({
  viewportX: coordinate,
  viewportY: coordinate,
  viewportWidth: z.number().min(160).max(8192),
  viewportHeight: z.number().min(120).max(8192),
});
export const mutationSchema = z.strictObject({
  mutationId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative(),
  expectedStatus: z.enum(["draft", "published"]),
});
export const createWorkSchema = windowSchema.extend({
  mutationId: z.string().uuid(),
  draftX: coordinate,
  draftY: coordinate,
});
export const framePatchSchema = windowSchema.partial().extend({
  draftX: coordinate.optional(), draftY: coordinate.optional(),
}).refine((value) => Object.keys(value).length > 0, "请提供要修改的字段");
export const workPostSchema = z.strictObject({
  title: z.string().max(200), content: z.string().max(20000),
});
export const photoPatchSchema = z.strictObject({
  x: coordinate.optional(), y: coordinate.optional(),
  width: z.number().min(120).max(640).optional(), height: z.number().min(90).max(800).optional(),
  rotation: z.number().min(-25).max(25).optional(),
  caption: z.string().max(200).optional(), zIndex: z.number().int().min(0).max(10000).optional(),
}).refine((value) => Object.keys(value).length > 0, "请提供要修改的字段");
export const uploadFieldsSchema = z.strictObject({
  x: coordinate, y: coordinate,
  width: z.number().min(120).max(640), height: z.number().min(90).max(800),
  caption: z.string().max(200).default(""),
});
export const workConnectionSchema = z.strictObject({
  fromId: workIdSchema, toId: workIdSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#72975a"),
});
export const workCommandSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("frame"), data: framePatchSchema }),
  z.strictObject({ operation: z.literal("post.create"), data: workPostSchema }),
  z.strictObject({ operation: z.literal("post.update"), id: workIdSchema, data: workPostSchema }),
  z.strictObject({ operation: z.literal("post.delete"), id: workIdSchema }),
  z.strictObject({ operation: z.literal("photo.update"), id: workIdSchema, data: photoPatchSchema }),
  z.strictObject({ operation: z.literal("photo.delete"), id: workIdSchema }),
  z.strictObject({ operation: z.literal("connection.create"), data: workConnectionSchema }),
  z.strictObject({ operation: z.literal("connection.update"), id: workIdSchema, data: workConnectionSchema }),
  z.strictObject({ operation: z.literal("connection.delete"), id: workIdSchema }),
  z.strictObject({ operation: z.literal("publish") }),
  z.strictObject({ operation: z.literal("delete") }),
]);
export const commandRequestSchema = mutationSchema.extend({ command: workCommandSchema });
export type WorkCommand = z.infer<typeof workCommandSchema>;
export type MutationInput = z.infer<typeof mutationSchema>;
export type WorkWindow = z.infer<typeof windowSchema>;
export type CreateWorkInput = z.infer<typeof createWorkSchema>;
