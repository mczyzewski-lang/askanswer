import { enqueue, type SocialJobType } from "../jobs";

/** enqueue a Social Media Studio job (same Postgres queue as the rest of the app) */
export function enqueueSocial(type: SocialJobType, payload: Record<string, unknown>, opts: { idempotencyKey?: string; maxAttempts?: number; runAt?: Date } = {}) {
  return enqueue(type, payload, { maxAttempts: 5, ...opts });
}
