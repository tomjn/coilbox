/**
 * Standard base64 over raw bytes.
 *
 * Its own module rather than living beside its first caller, because that caller
 * is the three.js unit renderer and everything that wants to base64 a picture
 * would then pull three in with it.
 */

/**
 * How many bytes go into one `String.fromCharCode` call.
 *
 * `fromCharCode(...bytes)` spreads its argument onto the stack, and a quarter of
 * a megabyte of render overruns it. 8192 is well inside every engine's argument
 * limit and turns the encode into a few dozen calls.
 */
const BASE64_CHUNK = 8192;

/**
 * Standard base64, which is how a render's pixels reach the command.
 *
 * Standard rather than the base64url `container.ts` uses, because the Rust side
 * decodes with `general_purpose::STANDARD` and the two alphabets differ in two
 * characters, which shows up as a decode failure roughly whenever the pixels
 * happen to contain a `>` or a `?` sextet.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + BASE64_CHUNK));
  }
  return btoa(binary);
}
