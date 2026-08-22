/**
 * Transactional email, fail-soft by design.
 *
 * Cloudflare Email Sending is beta, needs the Workers Paid plan, and cannot
 * send to arbitrary recipients until pomodoropet.com is onboarded — three
 * external states this code must not depend on. So: binding absent, sender
 * unset, or the send throwing all end the same way — the mail is skipped and
 * the caller's flow (signup, reset) continues. Nothing user-facing may ever
 * fail because an email could not go out.
 */

export interface MailBindings {
  /** Cloudflare Email Sending binding ([[send_email]]). Absent until the
   * Workers Paid plan + domain onboarding exist. */
  SEND_EMAIL?: {
    send(message: { to: string; from: string; subject: string; text?: string; html?: string }): Promise<void>;
  };
  /** Verified sender, e.g. "support@pomodoropet.com". Unset = sending off. */
  MAIL_FROM?: string;
  /** Where admin notifications (contact form, moderation digest) go — the
   * owner's inbox. Unset = those notifications are skipped (the data is in
   * D1 either way; the admin dashboard is the source of truth). */
  ADMIN_EMAIL?: string;
}

/** Returns true only when a mail actually went out. `text` is the whole
 * body — callers own their wording (auth links add their own "ignore this
 * if it wasn't you", the contact form forwards the message verbatim). */
export async function sendMail(env: MailBindings, to: string, subject: string, text: string): Promise<boolean> {
  if (!env.SEND_EMAIL || !env.MAIL_FROM || !to) return false;
  try {
    await env.SEND_EMAIL.send({ to, from: env.MAIL_FROM, subject, text });
    return true;
  } catch {
    // Beta service down, quota hit, domain not onboarded — all expected
    // states. The flow this rode on must not break.
    return false;
  }
}
