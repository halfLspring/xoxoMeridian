import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import { errorToResponse, jsonOk, noStoreResponse } from "@/lib/api";
import { parseBody, readJsonBody } from "@/lib/validation";
import { WorkError } from "@/lib/blog-work/policy";
import { mutationSchema, workIdSchema, type WorkCommand } from "@/lib/blog-work/schemas";
import { mutateWork } from "@/lib/blog-work/mutations";
import { readWork } from "@/lib/blog-work/queries";
import { cleanupBlogAssets } from "@/lib/blog-work/assets";

export async function workHttp(request: Request, fn: (actorId: string) => Promise<unknown>) {
  try {
    const user = await requireCurrentUser();
    const expected = request.headers.get("X-Blog-Viewer-Id");
    if ((request.method !== "GET" || expected) && expected !== user.id) throw new WorkError("AUTH_CHANGED", 401, "账号已改变，请重新登录");
    return noStoreResponse(jsonOk(await fn(user.id)));
  } catch (error) {
    if (error instanceof WorkError) return noStoreResponse(Response.json({ error: error.message, code: error.code }, { status: error.status }));
    return noStoreResponse(errorToResponse(error));
  }
}
export async function commandResponse(actorId: string, id: string, input: z.infer<typeof mutationSchema>, command: WorkCommand) {
  const result = await mutateWork(actorId, parseBody(workIdSchema, id), input, command);
  revalidatePath("/home");
  revalidatePath("/posts/[slug]", "page");
  if (command.operation.endsWith("delete") || command.operation === "delete") await cleanupBlogAssets().catch(() => {});
  return { ...result, mutationId: input.mutationId, work: result.deleted ? null : await readWork(actorId, id) };
}
export function resourceHandler(operation: WorkCommand["operation"]) {
  return (request: Request, context: { params: Promise<{ workId: string; resourceId?: string }> }) => workHttp(request, async actorId => {
    const params = await context.params;
    const raw = await readJsonBody(request, mutationSchema.extend({ data: z.unknown().optional() }));
    const { data, ...input } = raw;
    // 命令在领域服务内再经 discriminated schema 校验，类型断言不代替边界校验。
    return commandResponse(actorId, params.workId, input, { operation, ...(params.resourceId ? { id: params.resourceId } : {}), ...(data !== undefined ? { data } : {}) } as WorkCommand);
  });
}
