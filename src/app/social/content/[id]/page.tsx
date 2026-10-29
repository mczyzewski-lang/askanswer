import { ContentEditor } from "@/components/social/editor";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContentEditor id={id} />;
}
