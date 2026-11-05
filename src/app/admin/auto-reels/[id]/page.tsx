import { AutoReelsProject } from "@/components/admin/auto-reels";

export default async function AutoReelsProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AutoReelsProject id={id} />;
}
