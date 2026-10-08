import type { AnswerReferences as References } from "@/lib/answer-references";

const dateLabels = { published: "发布/更新", issued: "预报发布", observed: "观测", fetched: "获取" };

export function AnswerReferences({ content, references }: { content: string; references?: References }) {
  if (!references?.sources.length) return null;
  // 为 sr-only 的绝对定位建立局部包含块，防止辅助文本越过消息区裁切并撑大整页。
  return (
    <details className="relative mt-2 rounded-lg border border-black/10 bg-white/60 p-2 text-xs text-black/60">
      <summary className="cursor-pointer rounded-sm px-1 py-0.5 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-600">
        参考来源（{references.sources.length}）
      </summary>
      <ul className="mt-2 space-y-3 px-1">
        {references.sources.map((source) => (
          <li key={source.id} className="min-w-0 break-words">
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="font-medium text-sage-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2">
              {source.title}
              <span className="sr-only">（新窗口打开）</span>
            </a>
            <p className="mt-0.5">{new URL(source.url).hostname}</p>
            {source.dates.map((date) => <p key={`${date.kind}:${date.value}`}>{dateLabels[date.kind]}：{date.value}</p>)}
            <ul aria-label={`“${source.title}”对应的内容`} className="mt-1 space-y-1 border-l-2 border-sage-200 pl-2">
              {references.citations.filter((citation) => citation.sourceIds.includes(source.id)).map((citation) => (
                <li key={citation.start}><q className="whitespace-pre-wrap">{content.slice(citation.start, citation.end)}</q></li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}
