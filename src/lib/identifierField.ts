import type { InputHTMLAttributes } from "react";

/**
 * Spread onto an identifier field's `Input` (username, password, channel
 * name, host, IP, email, code, or a player/channel search box) to stop
 * macOS's WKWebView auto-capitalising, autocorrecting or spell-checking a
 * value that must match exactly (issue #2919): typing `cbadmin` became
 * `Cbadmin`. Leave free text fields, such as chat messages, ban reasons and
 * topics, unset.
 */
export const identifierFieldProps: Pick<
  InputHTMLAttributes<HTMLInputElement>,
  "autoCapitalize" | "autoCorrect" | "spellCheck"
> = {
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
};
