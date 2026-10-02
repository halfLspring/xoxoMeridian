import type { Page, Request, Response } from "@playwright/test";

// 只记录网络生命周期；业务响应及断言仍由用例直接 await，不在诊断层捕获异常。
export function observeResponseDiagnostics(
  page: Page,
  pathname: string,
  record: (event: Record<string, unknown>) => void,
) {
  const requests = new Map<Request, number>();
  const matches = (request: Request) => new URL(request.url()).pathname === pathname;
  const details = (request: Request) => ({ requestId: requests.get(request), method: request.method() });
  const onRequest = (request: Request) => {
    if (!matches(request)) return;
    requests.set(request, requests.size + 1);
    record({ event: "request", ...details(request) });
  };
  const onResponse = (response: Response) => {
    if (!matches(response.request())) return;
    record({ event: "response", ...details(response.request()), status: response.status(), timing: response.request().timing() });
  };
  // requestfinished 表示正文已下载；不创建会在页面关闭后继续等待的 finished() Promise。
  const onRequestFinished = (request: Request) => {
    if (matches(request)) record({ event: "body-finished", ...details(request), timing: request.timing() });
  };
  const onRequestFailed = (request: Request) => {
    if (matches(request)) record({ event: "request-failed", ...details(request), failure: request.failure(), timing: request.timing() });
  };
  const onPageError = (error: Error) => record({ event: "page-error", message: error.message });
  const onClose = () => record({ event: "page-closed" });
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onRequestFinished);
  page.on("requestfailed", onRequestFailed);
  page.on("pageerror", onPageError);
  page.on("close", onClose);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfinished", onRequestFinished);
    page.off("requestfailed", onRequestFailed);
    page.off("pageerror", onPageError);
    page.off("close", onClose);
    record({ event: "diagnostics-stopped", pageClosed: page.isClosed() });
    requests.clear();
  };
}
