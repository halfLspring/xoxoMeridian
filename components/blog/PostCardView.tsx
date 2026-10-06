import Link from "next/link";
import type { ReactNode } from "react";
import { MarkdownContent } from "@/components/blog/MarkdownContent";
import { formatPostTime } from "@/lib/post-time";

type PostCardViewProps = {
  title: string;
  content: string;
  authorName: string;
  timestamp: Date | string;
  authorTimezone?: string | null;
  authorCity?: string | null;
  authorCountry?: string | null;
  draft?: boolean;
  href?: string;
  onOpen?: () => void;
  openDisabled?: boolean;
  actions?: ReactNode;
};

// 容器提供数据和操作；两种入口只在这里定义卡片、时间与 Markdown 摘要。
export function PostCardView({ title, content, authorName, timestamp, authorTimezone, authorCity, authorCountry, draft, href, onOpen, openDisabled, actions }: PostCardViewProps) {
  const date = new Date(timestamp);
  return (
    <article className="timeline-card post-card w-full">
      <div className="post-card-meta metadata-mono flex flex-wrap items-center gap-2 mb-2">
        <span>{authorName}</span>{" "}
        <span aria-hidden="true">&middot;</span>{" "}
        <time dateTime={date.toISOString()}>
          {formatPostTime(date, { timezone: authorTimezone, city: authorCity, country: authorCountry })}
        </time>
        {draft && <>{" "}<span>草稿</span></>}
      </div>
      <h2 className="text-lg font-semibold text-black leading-snug">
        {href
          ? <Link href={href} className="post-card-open">{title}</Link>
          : <button type="button" className="post-card-open" disabled={openDisabled} onClick={onOpen}>{title}</button>}
      </h2>
      {content && <MarkdownContent content={content} variant="preview" />}
      {actions}
    </article>
  );
}
