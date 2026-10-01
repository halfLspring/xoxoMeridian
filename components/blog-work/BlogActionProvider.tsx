"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type BlogAction = "new" | "list";
type ActionIntent = { action: BlogAction };
type BlogActions = {
  intent: ActionIntent | null;
  requestAction: (action: BlogAction) => void;
  consume: (intent: ActionIntent) => void;
};

const BlogActionContext = createContext<BlogActions | null>(null);

export function BlogActionProvider({ children }: { children: ReactNode }) {
  // 状态属于本次账号页面。工作区尚未水合时保留最后一次选择，页面卸载后不跨页面重放。
  const [intent, setIntent] = useState<ActionIntent | null>(null);
  const requestAction = useCallback((action: BlogAction) => { setIntent({ action }); }, []);
  const consume = useCallback((handled: ActionIntent) => {
    setIntent(current => current === handled ? null : current);
  }, []);
  const value = useMemo(() => ({ intent, requestAction, consume }), [intent, requestAction, consume]);
  return <BlogActionContext.Provider value={value}>{children}</BlogActionContext.Provider>;
}

export function useBlogActions() {
  return useContext(BlogActionContext);
}
