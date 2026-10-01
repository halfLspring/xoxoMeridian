import { requireCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function assertPostOwnership(slug: string) {
  const user = await requireCurrentUser();
  const post = await prisma.post.findUnique({ where: { slug } });
  if (!post || !post.publishedAt) throw new Response("Not found", { status: 404 });
  if (post.authorId !== user.id) throw new Response("Forbidden", { status: 403 });
  return { user, post };
}
