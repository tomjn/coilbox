import { Button } from "@picoframe/frame";
import { useState } from "react";

/**
 * One press to put an address, or a link to one, on the clipboard.
 *
 * Reading an address off a screen and typing it wrong is the failure this is
 * here to prevent, so everything it sits beside stays selectable too: the
 * clipboard can be unavailable, and there is nothing to report and nothing to
 * fix when it is.
 *
 * `label` is the accessible name, and has to say which address this copies:
 * several of these sit in a column and "Copy" three times over names none of
 * them.
 */
export function CopyButton({
  value,
  label,
  children,
}: {
  /** The exact text to put on the clipboard. */
  value: string;
  /** The accessible name, for example "Copy 192.168.1.5:8200, for somebody on
   *  the same network as you". */
  label: string;
  /** What the button says before it has been pressed. */
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="h-6 shrink-0 px-2"
      aria-label={label}
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
    >
      {copied ? "Copied" : children}
    </Button>
  );
}
