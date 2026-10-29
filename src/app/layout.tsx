import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AskBy Studio",
  description: "Od pytania do profesjonalnie zmontowanego wideo eksperta w kilka minut.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0f1115" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set before paint by the Social Media Studio theme script
    <html lang="pl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
