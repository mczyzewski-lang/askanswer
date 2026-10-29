import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { SocialShell } from "@/components/social/shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Social Media Studio" };

// the theme is applied before paint (no flash): light / dark / system from localStorage
const THEME = `try{var t=localStorage.getItem("social-theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}`;

export default async function SocialLayout({ children }: { children: React.ReactNode }) {
  if (!(await currentUser())) redirect("/login?next=/social");
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME }} />
      <Suspense>
        <SocialShell>{children}</SocialShell>
      </Suspense>
    </>
  );
}
