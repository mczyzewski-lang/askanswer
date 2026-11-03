/** The deployed commit (Railway: set at build time, also available at runtime); "" when unknown (local). */
export function appCommit(): string {
  return (process.env.APP_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7);
}
