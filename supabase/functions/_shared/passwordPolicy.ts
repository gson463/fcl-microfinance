export const MIN_PASSWORD_LENGTH = 12;

export function validatePasswordStrength(password: unknown): { ok: boolean; message: string } {
  const pwd = typeof password === "string" ? password : "";
  if (pwd.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  return { ok: true, message: "" };
}
