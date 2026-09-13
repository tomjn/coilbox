/**
 * Whether a server's agreement text says it emailed a verification code. Pure.
 *
 * TASServer has no field for this, so the text is the only signal. uberserver adds
 * "A verification code has been sent to your email address" only when its email
 * verification is switched on, and accepts any code, or none, when it is off.
 * teiserver's default agreement opens with the same sentence and always wants a
 * code.
 */
export function agreementWantsCode(text: string): boolean {
  return /verification code/i.test(text);
}
