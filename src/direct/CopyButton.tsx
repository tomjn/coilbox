import { Button } from "@picoframe/frame";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** How long "Copied" stays on the button, in milliseconds. */
const COPIED_MS = 2000;

/**
 * One press to put an address, or a link to one, on the clipboard.
 *
 * Reading an address off a screen and typing it wrong is the failure this is
 * here to prevent, so everything it sits beside stays selectable too: the
 * clipboard can be unavailable, and there is nothing to report and nothing to
 * fix when it is.
 *
 * The button says "Copied" for a moment and then goes back to what it said, so
 * pressing it a second time shows the same answer again. A clipboard that refuses
 * says "Couldn't copy" the same way, rather than leaving the press looking as if
 * nothing happened.
 *
 * `label` is the accessible name, and has to say which address this copies:
 * several of these sit in a column and "Copy" three times over names none of
 * them.
 */
export function CopyButton({
  value,
  label,
  variant = "secondary",
  className,
  children,
}: {
  /** The exact text to put on the clipboard. */
  value: string;
  /** The accessible name, for example "Copy 192.168.1.5:8200, for somebody on
   *  the same network as you". */
  label: string;
  /** The picoframe button variant. The default is the quiet one that sits in a row
   *  of addresses. */
  variant?: "secondary" | "ghost" | "default";
  /** Appended to the button's own classes. */
  className?: string;
  /** What the button says before it has been pressed. */
  children: React.ReactNode;
}) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = (next: "copied" | "failed") => {
    setResult(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(null), COPIED_MS);
  };
  return (
    <Button
      type="button"
      variant={variant}
      className={cn("h-6 shrink-0 px-2", className)}
      aria-label={label}
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => show("copied"))
          .catch(() => show("failed"));
      }}
    >
      {result === "copied" ? (
        <>
          <Check className="size-3.5" />
          Copied
        </>
      ) : result === "failed" ? (
        "Couldn't copy"
      ) : (
        children
      )}
    </Button>
  );
}
