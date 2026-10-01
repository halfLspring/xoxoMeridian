import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { assertPostOwnership } from "@/lib/api-posts";
import { applyNoStoreHeaders, errorToResponse, jsonOk } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import { getPostVisibilityWhere } from "@/lib/post-visibility";
import { prisma } from "@/lib/prisma";
import { updatePublishedPost, deletePublishedPost } from "@/lib/blog-work/legacy-posts";
import { postUpdateSchema, readJsonBody } from "@/lib/validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const user = await requireCurrentUser();
    const { slug } = await params;

    const post = await prisma.post.findFirst({
      where: {
        slug,
        AND: [getPostVisibilityWhere(user.id)],
      },
      include: {
        author: {
          select: {
            id: true,
            displayName: true,
            avatarLabel: true,
            profile: { select: { timezone: true, city: true, country: true } },
          },
        },
      },
    });
    if (!post) {
      const response = NextResponse.json({ error: "Not found" }, { status: 404 });
      applyNoStoreHeaders(response.headers);
      return response;
    }

    const response = jsonOk({ post });
    applyNoStoreHeaders(response.headers);
    return response;
  } catch (error) {
    const response = errorToResponse(error);
    applyNoStoreHeaders(response.headers);
    return response;
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { user, post } = await assertPostOwnership(slug);
    const { title, content } = await readJsonBody(request, postUpdateSchema);

    const updated = await updatePublishedPost(post.id, user.id, { ...(title !== undefined ? { title } : {}), ...(content !== undefined ? { content } : {}) });

    revalidatePath("/home");

    const response = jsonOk({ post: updated });
    applyNoStoreHeaders(response.headers);
    return response;
  } catch (error) {
    const response = errorToResponse(error);
    applyNoStoreHeaders(response.headers);
    return response;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { user, post } = await assertPostOwnership(slug);

    await deletePublishedPost(post.id, user.id);

    revalidatePath("/home");

    const response = jsonOk({ deleted: true });
    applyNoStoreHeaders(response.headers);
    return response;
  } catch (error) {
    const response = errorToResponse(error);
    applyNoStoreHeaders(response.headers);
    return response;
  }
}
