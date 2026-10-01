import { z } from "zod";
import { cleanupBlogAssets } from "@/lib/blog-work/assets";
import { prisma } from "@/lib/prisma";
const args = process.argv.slice(2);
const unknown = args.filter(a => a !== "--dry-run" && !a.startsWith("--limit="));
if (unknown.length) throw new Error("仅支持 --dry-run 和 --limit=1..500");
const limit = z.coerce.number().int().min(1).max(500).parse(args.find(a => a.startsWith("--limit="))?.split("=")[1] ?? 100);
try { const result = await cleanupBlogAssets({ limit, dryRun: args.includes("--dry-run") }); console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1; }
finally { await prisma.$disconnect(); }
