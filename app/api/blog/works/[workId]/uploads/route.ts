import { workHttp } from "@/lib/blog-work/http";
import { uploadWorkPhoto } from "@/lib/blog-work/assets";
import { readWork } from "@/lib/blog-work/queries";
import { WorkError } from "@/lib/blog-work/policy";
import { mutationSchema, uploadFieldsSchema, workIdSchema } from "@/lib/blog-work/schemas";
import { parseBody } from "@/lib/validation";
import { AtlasImageValidationError } from "@/lib/storage/atlas-storage";
export const POST = (request: Request, context: { params: Promise<{ workId: string }> }) => workHttp(request, async actor => {
  const workId = parseBody(workIdSchema, (await context.params).workId);
  const form = await request.formData(), file = form.get("file");
  if (!(file instanceof File)) throw new WorkError("INVALID_FILE", 400, "请选择图片");
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("metadata"))); } catch { throw new WorkError("INVALID_INPUT", 400, "上传参数无效"); }
  const { data, ...input } = parseBody(mutationSchema.extend({ data: uploadFieldsSchema }), raw);
  try {
    const result = await uploadWorkPhoto(actor, workId, input, data, file);
    return { ...result, mutationId: input.mutationId, work: await readWork(actor, workId) };
  } catch (error) {
    if (error instanceof AtlasImageValidationError) throw new WorkError("INVALID_FILE", 400, "图片必须为 5MB 以内的 JPEG、PNG 或 WebP");
    throw error;
  }
});
