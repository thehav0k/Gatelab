/**
 * Feedback: validation, and the two ways a message can reach the inbox.
 *
 * This file is PURE (invariant 3) — it builds strings and checks fields. It does
 * not fetch, and it does not touch `window`. The component does that.
 *
 * There are two delivery paths and they exist for different failure modes:
 *
 *   POST   — the form endpoint. The message lands in the inbox without the user
 *            ever leaving the page, which is the only version anyone actually
 *            completes.
 *   mailto — the fallback. It cannot fail: it does not need a network, a service,
 *            or a form endpoint to be alive. It opens the user's own mail client
 *            with everything pre-filled.
 *
 * A contact form that silently drops the message when its third-party endpoint is
 * down is worse than no contact form, because the user believes they have been
 * heard. So the fallback is not decoration — it is what runs the moment the POST
 * does not come back clean.
 */

export const CONTACT = {
  email: "asifksifat@gmail.com",
  github: "thehav0k",
  githubUrl: "https://github.com/thehav0k",
  repoUrl: "https://github.com/thehav0k/gatelab",
  siteUrl: "https://gatelab-online.vercel.app",
} as const;

export const FEEDBACK_KINDS = ["Bug", "Idea", "Question", "Other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface Feedback {
  readonly kind: FeedbackKind;
  /** Optional — an anonymous bug report is still a bug report. */
  readonly from: string;
  readonly message: string;
}

export interface FeedbackErrors {
  readonly from?: string;
  readonly message?: string;
}

/**
 * Only the message is required.
 *
 * Demanding a name and an email before someone may tell you your K-map is wrong
 * is a good way to never find out that your K-map is wrong. But if they DO leave
 * an address, it had better be one that can be replied to — a typo'd address is
 * worse than a blank one, because it looks like an answer is coming.
 */
export function validateFeedback(f: Feedback): FeedbackErrors {
  const errors: { from?: string; message?: string } = {};

  const message = f.message.trim();
  if (message.length === 0) errors.message = "Say something, at least.";
  else if (message.length < 10) errors.message = "A little more detail would help.";
  else if (message.length > 5000) errors.message = "That is longer than 5000 characters.";

  const from = f.from.trim();
  if (from.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(from)) {
    errors.from = "That does not look like an email address.";
  }

  return errors;
}

export const isValid = (f: Feedback): boolean =>
  Object.keys(validateFeedback(f)).length === 0;

/** What the form endpoint receives. */
export interface FeedbackPayload {
  readonly _subject: string;
  readonly email: string;
  readonly kind: FeedbackKind;
  readonly message: string;
  readonly page: string;
  /** FormSubmit's honeypot — a bot fills every field it finds, a human cannot see this one. */
  readonly _honey: string;
}

export function feedbackPayload(f: Feedback, page: string): FeedbackPayload {
  const from = f.from.trim();
  return {
    _subject: `Gatelab · ${f.kind}`,
    // The endpoint uses this as the Reply-To. With no address given, replying to the
    // mail should fail loudly rather than silently go nowhere.
    email: from || "anonymous@gatelab.invalid",
    kind: f.kind,
    message: f.message.trim(),
    page,
    _honey: "",
  };
}

/**
 * The fallback. Everything the POST would have carried, folded into a mail the
 * user's own client can send.
 */
export function mailtoUrl(f: Feedback, page: string): string {
  const subject = `Gatelab · ${f.kind}`;
  const body = [
    f.message.trim(),
    "",
    "—",
    `sent from: ${page}`,
    ...(f.from.trim() ? [`reply to: ${f.from.trim()}`] : []),
  ].join("\n");

  return `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
