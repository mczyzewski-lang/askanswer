import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/server/auth";
import { Studio } from "@/components/studio/studio";

export const metadata: Metadata = { title: "Studio — AskBy Studio" };
export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const { id } = await params;
  return <Studio id={id} />;
}
