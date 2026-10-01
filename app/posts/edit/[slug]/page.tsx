import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PostEditor } from "@/components/blog/PostEditor";
import { BackToBlog } from "@/components/blog/BackToBlog";
import { SiteNav } from "@/components/blog/SiteNav";
import { PageTransition } from "@/components/layout/PageTransition";

export const dynamic = "force-dynamic";

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await requirePageUser();
  const { slug } = await params;

  const post = await prisma.post.findUnique({
    where: { slug },
  });

  if (!post || !post.publishedAt) notFound();
  if (post.authorId !== user.id) redirect("/home");
  if (post.workId) redirect(`/home?work=${post.workId}&post=${post.id}`);

  return (
    <div className="min-h-screen bg-sage-50">
      <SiteNav currentUser={user} />
      <PageTransition>
        <main className="mx-auto max-w-3xl px-6 py-12">
          <h1 className="text-2xl font-bold text-black mb-8">Edit Post</h1>
          <PostEditor
            currentUser={user}
            initialValues={{
              title: post.title,
              content: post.content,
              slug: post.slug,
            }}
          />
        </main>
        <BackToBlog />
      </PageTransition>
    </div>
  );
}
