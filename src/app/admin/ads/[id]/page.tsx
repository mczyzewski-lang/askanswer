import { AdsProject } from "@/components/admin/ads-studio";

export default async function AdsProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdsProject id={id} />;
}
