/** Workflow of one publication target. Nothing reaches the provider without a human approval. */
export type PostStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REJECTED"
  | "SCHEDULING"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "SCHEDULING_FAILED"
  | "PUBLISH_FAILED"
  | "CANCELLED"
  | "REAUTH_REQUIRED";

export const POST_STATUS: Record<PostStatus, { label: string; tone: "gray" | "amber" | "blue" | "green" | "red" | "violet" }> = {
  DRAFT: { label: "Szkic", tone: "gray" },
  PENDING_APPROVAL: { label: "Do akceptacji", tone: "amber" },
  APPROVED: { label: "Zatwierdzone", tone: "violet" },
  CHANGES_REQUESTED: { label: "Do poprawy", tone: "amber" },
  REJECTED: { label: "Odrzucone", tone: "red" },
  SCHEDULING: { label: "Planowanie…", tone: "blue" },
  SCHEDULED: { label: "Zaplanowane", tone: "blue" },
  PUBLISHING: { label: "Publikowanie…", tone: "blue" },
  PUBLISHED: { label: "Opublikowane", tone: "green" },
  SCHEDULING_FAILED: { label: "Błąd planowania", tone: "red" },
  PUBLISH_FAILED: { label: "Błąd publikacji", tone: "red" },
  CANCELLED: { label: "Anulowane", tone: "gray" },
  REAUTH_REQUIRED: { label: "Połącz konto ponownie", tone: "red" },
};

/** statuses in which the text / file / account / date may still be edited */
export const EDITABLE: PostStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "CHANGES_REQUESTED", "REJECTED", "SCHEDULED", "SCHEDULING_FAILED", "PUBLISH_FAILED", "CANCELLED", "REAUTH_REQUIRED"];
/** statuses with an order at the provider that may still change (cancel / edit) */
export const AT_PROVIDER: PostStatus[] = ["SCHEDULING", "SCHEDULED", "PUBLISHING"];
export const FINAL: PostStatus[] = ["PUBLISHED"];

export const isEditable = (s: PostStatus) => EDITABLE.includes(s);
export const canSubmit = (s: PostStatus) => s === "DRAFT" || s === "CHANGES_REQUESTED" || s === "REJECTED" || s === "CANCELLED";
export const canDecide = (s: PostStatus) => s === "PENDING_APPROVAL";
export const canCancel = (s: PostStatus) => !["PUBLISHED", "CANCELLED", "PUBLISHING"].includes(s);
