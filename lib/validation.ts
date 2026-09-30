import { z } from "zod";

import { HOME_PHOTO_MAX_ROTATION } from "@/lib/home-spatial";
import { memoCreateFields, memoUpdateFields, scheduleDescriptionSchema } from "@/lib/life-authoring-contract";
import {
  hasAtMostOneScheduledJobTrigger,
  hasExactlyOneScheduledJobTrigger,
  scheduledJobFireAtSchema,
} from "@/lib/scheduled-job-one-shot";

const trim = (s: unknown) => (typeof s === "string" ? s.trim() : s);

export const registerSchema = z.object({
  email: z.preprocess(trim, z.string().email().max(254).transform((s) => s.toLowerCase())),
  password: z.string().min(6).max(256),
  displayName: z.preprocess(trim, z.string().min(1).max(40)),
  inviteCode: z.string().min(1).max(128),
  city: z.preprocess(trim, z.string().min(1).max(80)).optional(),
  country: z.preprocess(trim, z.string().min(1).max(80)).optional(),
  timezone: z.preprocess(trim, z.string().min(1).max(64)).optional(),
});

export const loginSchema = z.object({
  email: z.preprocess(trim, z.string().email().max(254).transform((s) => s.toLowerCase())),
  password: z.string().min(1).max(256),
});

export const profileUpdateSchema = z
  .object({
    displayName: z.preprocess(trim, z.string().min(1).max(40)).optional(),
    profileNote: z.preprocess(trim, z.string().max(2000)).optional(),
    city: z.preprocess(trim, z.string().min(1).max(80)).optional(),
    country: z.preprocess(trim, z.string().min(1).max(80)).optional(),
    timezone: z.preprocess(trim, z.string().min(1).max(64)).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field is required",
  });

export const messagePostSchema = z.object({
  content: z.preprocess(trim, z.string().min(1).max(4000)),
  forceAgent: z.boolean().optional().default(false),
});

export const agentConversationMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  clientMessageId: z.string().uuid(),
}).strict();

export const agentViewerIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);


const safeMetadataSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .refine(
    (v) => {
      if (!v) return true;
      try {
        return JSON.stringify(v).length <= 4_000;
      } catch {
        return false;
      }
    },
    { message: "metadata too large or unserializable" }
  );

export const memoPostSchema = z.object({
  ...memoCreateFields,
  metadata: safeMetadataSchema,
});

export const memoPatchSchema = z
  .object({
    ...memoUpdateFields,
    metadata: safeMetadataSchema,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field is required",
  });

export const scheduledJobPostSchema = z
  .object({
    fireAt: scheduledJobFireAtSchema.optional(),
    cron: z.string().min(9).max(128).optional(),
    timezone: z.string().min(1).max(64),
    prompt: z.preprocess(trim, z.string().min(1).max(500)),
    description: scheduleDescriptionSchema.optional(),
    runOnce: z.boolean().optional(),
  })
  .refine(hasExactlyOneScheduledJobTrigger, {
    message: "Exactly one of fireAt or cron is required",
  });

export const scheduledJobPatchSchema = z
  .object({
    fireAt: scheduledJobFireAtSchema.optional(),
    cron: z.string().min(9).max(128).optional(),
    timezone: z.string().min(1).max(64).optional(),
    prompt: z.preprocess(trim, z.string().min(1).max(500)).optional(),
    description: scheduleDescriptionSchema.optional(),
    runOnce: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .refine(hasAtMostOneScheduledJobTrigger, {
    message: "fireAt and cron cannot be provided together",
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field is required",
  });

export const roomCreateSchema = z.object({
  name: z.preprocess(trim, z.string().min(1).max(80)).optional(),
});

export const agentDispatchSchema = z
  .object({
    roomId: z.string().min(1).max(64),
    content: z.preprocess(trim, z.string().min(1).max(4000)).optional(),
    sourceMessageId: z.string().min(1).max(64).optional(),
  })
  .refine((v) => v.content || v.sourceMessageId, {
    message: "Either content or sourceMessageId is required",
  });

export const toolApprovalDecisionSchema = z.object({
  approvalId: z.string().min(1).max(64),
  decision: z.enum(["approve", "reject"]),
});

export const studyModeSchema = z.enum(["focus", "short", "long"]);

export const studyStartSchema = z.object({
  mode: studyModeSchema.optional().default("focus"),
  plannedMinutes: z.number().int().min(1).max(180).optional(),
});

export const studyTransitionSchema = z.object({
  sessionKey: z.string().min(1).max(128),
});

export const studyGoalPostSchema = z.object({
  text: z.preprocess(trim, z.string().min(1).max(200)),
});

export const studyGoalPatchSchema = z
  .object({
    text: z.preprocess(trim, z.string().min(1).max(200)).optional(),
    done: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field is required",
  });

// --------------- Post ---------------

// 发布与更新共用的写入契约：HTTP Route 与 Server Action 在生成 slug 前解析同一 schema，
// 畸形、无界与空 patch 输入在这里变成稳定的验证错误，不再带着 TypeScript 的假设进入 Prisma。
// 字段级文案是客户端可见契约的一部分（Action 会把首条 issue 直接呈现给编辑器）。
export const POST_TITLE_MAX_LENGTH = 200;
export const POST_CONTENT_MAX_LENGTH = 20_000;

const postTitleSchema = z
  .string({ error: "Title must be text" })
  .trim()
  .min(1, "Title is required")
  .max(POST_TITLE_MAX_LENGTH, `Title must be ${POST_TITLE_MAX_LENGTH} characters or fewer`);

const postContentSchema = z
  .string({ error: "Content must be text" })
  .trim()
  .min(1, "Content is required")
  .max(POST_CONTENT_MAX_LENGTH, `Content must be ${POST_CONTENT_MAX_LENGTH} characters or fewer`);

export const postCreateSchema = z.object({
  title: postTitleSchema,
  content: postContentSchema,
});

export const postUpdateSchema = z
  .object({
    title: postTitleSchema.optional(),
    content: postContentSchema.optional(),
  })
  .refine((v) => v.title !== undefined || v.content !== undefined, {
    message: "At least one field is required",
  });

// Server Action 的 slug 参数同样是客户端可构造的边界，不能只用 TypeScript 类型约束。
export const postSlugSchema = z
  .string({ error: "Post slug must be text" })
  .trim()
  .min(1, "Post slug is required")
  .max(200, "Post slug is too long");

export class ValidationError extends Error {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;
  constructor(issues: z.ZodIssue[]) {
    super("Validation failed");
    this.name = "ValidationError";
    this.issues = issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
  }
}

// --------------- Atlas ---------------

export const atlasElementCreateSchema = z.object({
  type: z.enum(["note", "photo"]),
  x: z.number().finite(),
  y: z.number().finite(),
  content: z.preprocess(trim, z.string().max(2000)).optional(),
  caption: z.preprocess(trim, z.string().max(200)).optional(),
  rotation: z.number().min(-15).max(15).optional(),
});

export const atlasElementPatchSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    rotation: z.number().min(-15).max(15).optional(),
    zIndex: z.number().int().min(0).max(10000).optional(),
    content: z.preprocess(trim, z.string().max(2000)).optional(),
    caption: z.preprocess(trim, z.string().max(200)).optional(),
    width: z.number().positive().max(800).optional(),
    height: z.number().positive().max(800).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field is required",
  });

export const atlasConnectionCreateSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  color: z.string().max(20).optional(),
});

// --------------- Home spatial board ---------------

export const homeBoardElementPatchSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    rotation: z.number().finite().min(-HOME_PHOTO_MAX_ROTATION).max(HOME_PHOTO_MAX_ROTATION).optional(),
    zIndex: z.number().int().min(0).max(10000).optional(),
    caption: z.preprocess(trim, z.string().max(200)).optional(),
    width: z.number().positive().min(120).max(640).optional(),
    height: z.number().positive().min(90).max(800).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field is required",
  });

export const homeBoardConnectionCreateSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  color: z.string().max(20).optional(),
});

export const atlasDragSchema = z.object({
  elementId: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
});

// --------------- 上传（multipart/form-data） ---------------

/**
 * 表单字段只可能是字符串或 File，而 File 不是文本。先拒绝非字符串/非数值字段，
 * 再交给 `z.coerce.number`：否则 `Number(File)` 会得到 NaN 并被 `|| 0` 静默吃掉。
 */
function formNumberField(fallback: number, label: string, options: { positive?: boolean } = {}) {
  const base = z.coerce.number({ error: `${label} must be a number` });

  return z.preprocess((value) => {
    if (value === null || value === undefined) {
      return fallback;
    }

    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? fallback : trimmed;
    }

    return Number.NaN;
  }, options.positive ? base.positive(`${label} must be a positive number`) : base);
}

function formCaptionField() {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined) {
        return "";
      }

      // 非文本字段原样交给 z.string 拒绝，不要在这里转成字符串。
      return typeof value === "string" ? value.trim() : value;
    },
    z.string({ error: "Caption must be text" }).max(200, "Caption must be 200 characters or fewer")
  );
}

const uploadSharedFields = {
  x: formNumberField(0, "x"),
  y: formNumberField(0, "y"),
  caption: formCaptionField(),
};

/** 首页照片上传：与 Atlas 共用坐标与标题，另加展示尺寸。 */
export const homeUploadFieldsSchema = z.object({
  ...uploadSharedFields,
  width: formNumberField(240, "width", { positive: true }),
  height: formNumberField(180, "height", { positive: true }),
});

/** Atlas 照片上传：只消费坐标与标题，两处共用同一份字段语义。 */
export const atlasUploadFieldsSchema = z.object(uploadSharedFields);

/** 按名字取原始表单值；字段缺席时为 null，交由 schema 决定默认值。 */
export function readFormFields(formData: FormData, names: readonly string[]) {
  const fields: Record<string, FormDataEntryValue | null> = {};

  for (const name of names) {
    fields[name] = formData.get(name);
  }

  return fields;
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(result.error.issues);
  }
  return result.data;
}

export async function readJsonBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  const body = await request.json().catch(() => ({}));
  return parseBody(schema, body);
}
