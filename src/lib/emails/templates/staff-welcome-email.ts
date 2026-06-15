import {
  buildCtaButton,
  escapeHtml,
  renderBaseTemplate,
} from "./base-template";

export interface StaffWelcomeEmailParams {
  venueName: string;
  /** Recipient sign-in email */
  email: string;
  password: string;
  role: "admin" | "staff";
  loginUrl: string;
}

/**
 * HTML + plain text for “account created” emails to new venue staff.
 * Caller must only use after the user has been created; contains credentials.
 */
export function renderStaffWelcomeEmail(params: StaffWelcomeEmailParams): {
  html: string;
  text: string;
} {
  const roleLabel = params.role === "admin" ? "Admin" : "Staff";

  const mainContent = [
    '<p style="margin:0 0 12px">A dashboard account has been created for you on ResNeo.</p>',
    `<p style="margin:0 0 8px"><strong>Sign-in email:</strong> ${escapeHtml(params.email)}</p>`,
    `<p style="margin:0 0 8px"><strong>Password:</strong> ${escapeHtml(params.password)}</p>`,
    `<p style="margin:0 0 16px"><strong>Access level:</strong> ${escapeHtml(roleLabel)}</p>`,
    '<p style="margin:0 0 16px;font-size:14px;color:#64748b">You can sign in straight away. You do not need to confirm your email address first. For security, consider changing your password after you log in.</p>',
    buildCtaButton("Log in to dashboard", params.loginUrl),
  ].join("\n");

  const html = renderBaseTemplate({
    venueName: params.venueName,
    heading: "Your dashboard login details",
    mainContent,
    footerNote:
      "You received this email because a team member created a ResNeo dashboard account for you.",
  });

  const text = [
    `Your ResNeo dashboard account for ${params.venueName}`,
    "",
    `Sign-in email: ${params.email}`,
    `Password: ${params.password}`,
    `Access level: ${roleLabel}`,
    "",
    "You can sign in immediately; no email confirmation is required.",
    `Log in: ${params.loginUrl}`,
    "",
    "Consider changing your password after your first login.",
  ].join("\n");

  return { html, text };
}
