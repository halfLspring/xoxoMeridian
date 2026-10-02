import Link from "next/link";
import { PostCardView } from "@/components/blog/PostCardView";
import { resolveAuthorLocation } from "@/lib/post-time";

type PostCardProps = {
  post: {
    id: string;
    slug: string;
    title: string;
    content: string;
    publishedAt: Date | string;
    authorCity?: string | null;
    authorCountry?: string | null;
    authorTimezone?: string | null;
    author: {
      id: string;
      displayName: string;
      avatarLabel: string;
      profile?: { timezone: string; city: string; country: string } | null;
    } | null;
  };
  isOwner: boolean;
};

export function PostCard({ post, isOwner }: PostCardProps) {
  const location = resolveAuthorLocation(post);
  return (
    <PostCardView
      title={post.title}
      content={post.content}
      authorName={post.author?.displayName ?? "System"}
      timestamp={post.publishedAt}
      authorTimezone={post.authorTimezone}
      authorCity={location.city}
      authorCountry={location.country}
      href={`/posts/${post.slug}`}
      actions={isOwner && (
        <div className="mt-3 flex gap-2">
          <Link
            href={`/posts/edit/${post.slug}`}
            className="post-card-edit"
          >
            Edit
          </Link>
        </div>
      )}
    />
  );
}
