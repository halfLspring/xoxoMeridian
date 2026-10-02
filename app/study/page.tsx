import { SiteNav } from "@/components/blog/SiteNav";
import { StudyDashboard } from "@/components/study/StudyDashboard";
import { requirePageUser } from "@/lib/auth";
import { getStudyPageData } from "@/lib/study";

export const dynamic = "force-dynamic";

export default async function StudyPage() {
  const user = await requirePageUser();
  const timeZone = user.profile?.timezone ?? "UTC";
  const initialData = await getStudyPageData(
    { id: user.id, displayName: user.displayName, avatarLabel: user.avatarLabel },
    timeZone,
  );

  return (
    <div className="min-h-screen bg-sage-50">
      <SiteNav displayName={user.displayName} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <StudyDashboard initialData={initialData} />
      </main>
    </div>
  );
}
