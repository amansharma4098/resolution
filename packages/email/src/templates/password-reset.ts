/** Content for the password-reset email — kept as plain data (subject/text/html) rather
 *  than a React/JSX template, since this is the only transactional email in the project so
 *  far; a templating layer can come back once there's a second one to share it with. */
export function passwordResetEmail(opts: {
  resetUrl: string;
  expiresInMinutes: number;
}): { subject: string; text: string; html: string } {
  const { resetUrl, expiresInMinutes } = opts;
  return {
    subject: "Reset your Resolution password",
    text: [
      "We received a request to reset your Resolution password.",
      "",
      `Reset it here: ${resetUrl}`,
      "",
      `This link expires in ${expiresInMinutes} minutes. If you didn't request this, you can ignore this email — your password won't change.`,
    ].join("\n"),
    html: `
      <p>We received a request to reset your Resolution password.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires in ${expiresInMinutes} minutes. If you didn't request this, you can ignore this email — your password won't change.</p>
    `.trim(),
  };
}
