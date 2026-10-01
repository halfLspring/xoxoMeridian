"use client";
import { useId } from "react";
export function WorkPostForm({ value, onChange, readOnly = false }: { value: { title: string; content: string }; onChange: (value: { title: string; content: string }) => void; readOnly?: boolean }) {
  const id = useId();
  return <div className="work-post-form">
    <label htmlFor={`${id}-title`}>标题</label><input id={`${id}-title`} maxLength={200} readOnly={readOnly} value={value.title} onChange={e => onChange({ ...value, title: e.target.value })} />
    <label htmlFor={`${id}-content`}>正文（Markdown）</label><textarea id={`${id}-content`} maxLength={20000} readOnly={readOnly} rows={12} value={value.content} onChange={e => onChange({ ...value, content: e.target.value })} />
  </div>;
}
