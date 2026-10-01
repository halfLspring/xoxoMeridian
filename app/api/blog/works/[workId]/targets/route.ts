import { z } from "zod";
import { workHttp } from "@/lib/blog-work/http";
import { connectionTargets } from "@/lib/blog-work/queries";
import { parseBody } from "@/lib/validation";
export const GET = (request: Request, context: { params: Promise<{ workId: string }> }) => workHttp(request, async actor => ({ targets: await connectionTargets(actor, (await context.params).workId, parseBody(z.string().max(200), new URL(request.url).searchParams.get("q") ?? "")) }));
