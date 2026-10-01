import { workHttp } from "@/lib/blog-work/http";
import { queryBlogFeed } from "@/lib/blog-work/feed";
export const GET = (request: Request) => workHttp(request, actor => queryBlogFeed(actor, Object.fromEntries(new URL(request.url).searchParams)));
