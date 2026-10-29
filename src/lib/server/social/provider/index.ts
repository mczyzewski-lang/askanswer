import { uploadPostLive } from "../../env";
import { DemoProvider } from "./mock";
import { UploadPostProvider } from "./upload-post";
import type { SocialProvider } from "./types";

export * from "./types";

let live: UploadPostProvider | null = null;
const demo = new DemoProvider();

/**
 * The provider for a project / account. DEMO data always goes to the mock — whatever the key — so a
 * demo post can never be published on a real account. Without a key everything is DEMO.
 */
export function providerFor(target: { isDemo: boolean }): SocialProvider {
  if (target.isDemo || !uploadPostLive()) return demo;
  live ??= new UploadPostProvider();
  return live;
}

/** new projects are DEMO when the studio runs without an Upload-Post key */
export const demoMode = () => !uploadPostLive();
