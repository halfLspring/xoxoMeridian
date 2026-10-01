import { workHttp, commandResponse, resourceHandler } from "@/lib/blog-work/http";
import { readWork } from "@/lib/blog-work/queries";
import { commandRequestSchema } from "@/lib/blog-work/schemas";
import { readJsonBody } from "@/lib/validation";
type Context = { params: Promise<{ workId: string }> };
export const GET = (request: Request, context: Context) => workHttp(request, async actor => ({ work: await readWork(actor, (await context.params).workId) }));
export const PATCH = (request: Request, context: Context) => workHttp(request, async actor => {
  const { command, ...input } = await readJsonBody(request, commandRequestSchema);
  return commandResponse(actor, (await context.params).workId, input, command);
});
export const DELETE = resourceHandler("delete");
