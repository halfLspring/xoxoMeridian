import { workHttp } from "@/lib/blog-work/http";
import { createWorkSchema } from "@/lib/blog-work/schemas";
import { createWork } from "@/lib/blog-work/mutations";
import { listDrafts, readWork } from "@/lib/blog-work/queries";
import { readJsonBody } from "@/lib/validation";
export const GET = (request: Request) => workHttp(request, actor => listDrafts(actor, Object.fromEntries(new URL(request.url).searchParams)));
export const POST = (request: Request) => workHttp(request, async actor => {
  const input = await readJsonBody(request, createWorkSchema);
  const result = await createWork(actor, input);
  return { ...result, mutationId: input.mutationId, work: await readWork(actor, result.workId) };
});
