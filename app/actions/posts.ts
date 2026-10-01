"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { INTERNAL_ERROR_MESSAGE, logInternalError } from "@/lib/internal-error";
import { prisma } from "@/lib/prisma";
import { createStandalonePost, updatePublishedPost, deletePublishedPost } from "@/lib/blog-work/legacy-posts";
import {
  ValidationError,
  parseBody,
  postCreateSchema,
  postSlugSchema,
  postUpdateSchema,
} from "@/lib/validation";

type PostResult = { id: string; slug: string; title: string };
type ActionResult<T> = { error: string } | T;

// 非预期异常对编辑器只呈现稳定文案：Error.message 是服务端实现细节，
// 既不随开发/生产变化，也不把 Prisma、provider 或 stack 文本交给客户端。
function serverError(err: unknown, ctx: string): { error: string } {
  logInternalError(ctx, err);
  return { error: INTERNAL_ERROR_MESSAGE };
}

// 验证失败是稳定的用户可见文案；其余内部异常仍交给 serverError 处理。
function invalidInput(err: ValidationError): { error: string } {
  return { error: err.issues[0]?.message ?? "Invalid request" };
}

export async function createPost(
  title: string,
  content: string
): Promise<ActionResult<{ post: PostResult }>> {
  try {
    const user = await getCurrentUser();
    if (!user) return { error: "Unauthorized" };

    const input = parseBody(postCreateSchema, { title, content });

    const post = await createStandalonePost(user, input);

    revalidatePath("/home");
    return { post: { id: post.id, slug: post.slug, title: post.title } };
  } catch (err) {
    if (err instanceof ValidationError) return invalidInput(err);
    return serverError(err, "createPost");
  }
}

export async function updatePost(
  slug: string,
  title: string,
  content: string
): Promise<ActionResult<{ post: PostResult }>> {
  try {
    const user = await getCurrentUser();
    if (!user) return { error: "Unauthorized" };

    const postSlug = parseBody(postSlugSchema, slug);
    const { title: nextTitle, content: nextContent } = parseBody(postUpdateSchema, { title, content });

    const existing = await prisma.post.findUnique({ where: { slug: postSlug } });
    if (!existing || !existing.publishedAt) return { error: "Not found" };
    if (existing.authorId !== user.id) return { error: "Forbidden" };

    const updated = await updatePublishedPost(existing.id, user.id, { ...(nextTitle !== undefined ? { title: nextTitle } : {}), ...(nextContent !== undefined ? { content: nextContent } : {}) });

    revalidatePath("/home");
    return { post: { id: updated.id, slug: updated.slug, title: updated.title } };
  } catch (err) {
    if (err instanceof ValidationError) return invalidInput(err);
    return serverError(err, "updatePost");
  }
}

export async function deletePost(
  slug: string
): Promise<ActionResult<{ deleted: true }>> {
  try {
    const user = await getCurrentUser();
    if (!user) return { error: "Unauthorized" };

    const postSlug = parseBody(postSlugSchema, slug);

    const existing = await prisma.post.findUnique({ where: { slug: postSlug } });
    if (!existing || !existing.publishedAt) return { error: "Not found" };
    if (existing.authorId !== user.id) return { error: "Forbidden" };

    await deletePublishedPost(existing.id, user.id);

    revalidatePath("/home");
    return { deleted: true };
  } catch (err) {
    if (err instanceof ValidationError) return invalidInput(err);
    return serverError(err, "deletePost");
  }
}
