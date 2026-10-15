import type { Metadata, Viewport } from "next";
import { Recorder } from "./recorder";

export const metadata: Metadata = { title: "Nagrywanie odpowiedzi — AskBy Studio", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover", themeColor: "#0c0d10" };

export default async function RecordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Recorder token={token} />;
}
