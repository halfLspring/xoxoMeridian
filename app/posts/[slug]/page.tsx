import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getPostVisibilityWhere } from "@/lib/post-visibility";
import { prisma } from "@/lib/prisma";
import { PostDetail } from "@/components/blog/PostDetail";
import { BackToBlog } from "@/components/blog/BackToBlog";
import { SiteNav } from "@/components/blog/SiteNav";
import { PageTransition } from "@/components/layout/PageTransition";

export const dynamic = "force-dynamic";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await requirePageUser();
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

  if (!post) notFound();

  return (
    <div className="min-h-screen bg-sage-50">
      <SiteNav displayName={user.displayName} />
      <PageTransition>
        <main className="mx-auto max-w-3xl px-6 py-12">
          {post.workId && <Link href={`/home?work=${post.workId}`}>返回所属作品</Link>}
          <PostDetail
            post={JSON.parse(JSON.stringify(post))}
            isOwner={post.authorId === user.id}
          />
        </main>
        <BackToBlog />
      </PageTransition>
    </div>
  );
}
