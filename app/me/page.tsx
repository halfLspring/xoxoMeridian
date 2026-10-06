import Link from "next/link";

import { MeForm } from "@/app/me/MeForm";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const user = await requirePageUser();
  const profile = await prisma.userProfile.findUnique({
    where: { userId: user.id },
    select: {
      city: true,
      country: true,
      profileNote: true,
    },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10 bg-sage-50">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-semibold text-black">个人设置</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-black/50">
            这里的内容会作为额外背景注入到房间助手的提示里。
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/home"
            className="rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-2.5 text-sm font-medium text-black/60 transition-colors duration-200 hover:bg-neutral-50 focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden cursor-pointer"
          >
            返回主页
          </Link>
          <Link
            href="/chat"
            className="rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-2.5 text-sm font-medium text-black/60 transition-colors duration-200 hover:bg-neutral-50 focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden cursor-pointer"
          >
            返回聊天
          </Link>
        </div>
      </header>

      <MeForm
        initial={{
          displayName: user.displayName,
          city: profile?.city ?? "",
          country: profile?.country ?? "",
          profileNote: profile?.profileNote ?? "",
        }}
      />
    </main>
  );
}
