import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { prisma } from "@/lib/server/db";
import { currentUser, projectScope } from "@/lib/server/auth";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Google Adwords: pick the project (each has its own campaigns and components). */
export default async function AdwordsHome() {
  const me = await currentUser();
  const projects = me
    ? await prisma.project.findMany({ where: await projectScope(me), orderBy: { updatedAt: "desc" }, select: { id: true, name: true, _count: { select: { adwordsAssets: true, adwordsCampaigns: true } } } })
    : [];
  return (
    <div>
      <h1 className="font-display text-[28px] font-semibold">Google Adwords</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">Komponenty kampanii Performance Max dla projektu: grafiki w motywie marki, wideo (scenariusz, storyboard, MP4), teksty, ocena, walidacja i paczka dla agencji. Wybierz projekt.</p>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {projects.map((p) => (
          <Link key={p.id} href={`/admin/adwords/${p.id}`}>
            <Card className="p-5 transition hover:shadow-md" data-testid="adwords-project">
              <div className="flex items-start justify-between">
                <p className="font-medium">{p.name}</p>
                <ArrowUpRight className="h-4 w-4 text-muted" />
              </div>
              <p className="mt-1 text-sm text-muted">{p._count.adwordsAssets ? `${p._count.adwordsAssets} komponentów · ${p._count.adwordsCampaigns} kampanie` : "brak komponentów — zaimportuj CSV"}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
