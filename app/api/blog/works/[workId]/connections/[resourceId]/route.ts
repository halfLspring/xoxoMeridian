import { resourceHandler } from "@/lib/blog-work/http";
export const PATCH = resourceHandler("connection.update");
export const DELETE = resourceHandler("connection.delete");
