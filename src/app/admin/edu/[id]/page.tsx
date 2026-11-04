import { EduDetail } from "@/components/admin/edu-studio";

export default async function EduVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EduDetail id={id} />;
}
