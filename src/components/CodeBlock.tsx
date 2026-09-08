/**
 * A block of source, coloured by shiki.
 *
 * Lifted out of the archive browser's `FilePreview.tsx`, which had it as a
 * private `TextPreview`, so the unit page can show a Lua table without a third
 * copy of the same six lines (issue #2695). The mission code view is the other
 * place coilbox colours Lua and it deliberately does not use this: it needs a
 * line-number gutter and find's highlights layered onto the same characters, so
 * it calls `codeToTokens` and composes each line itself. See
 * `missionLuaTokens.ts` for why.
 *
 * Both themes are emitted at once rather than one chosen here. shiki writes the
 * light colours inline and the dark ones as `--shiki-dark` custom properties,
 * and one rule in `index.css` swaps them under `.dark`. A component cannot pick
 * for itself without subscribing to the appearance, and a hard-coded dark block
 * on a light page is what the archive browser looked like before this.
 */
import { cn } from "@picoframe/frame";
import { useEffect, useState } from "react";

const HIGHLIGHTED = "overflow-auto text-xs [&_pre]:!m-0 [&_pre]:!p-3";
const PLAIN = "overflow-auto bg-card p-3 font-mono text-xs";

export function CodeBlock({
  code,
  lang,
  className,
  label,
}: {
  code: string;
  /** A shiki language id, or `text` for no colouring. */
  lang: string;
  className?: string;
  /** What a screen reader calls the block. */
  label?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    import("shiki")
      .then(({ codeToHtml }) =>
        codeToHtml(code, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: "light",
        }),
      )
      .then((h) => {
        if (!cancelled) setHtml(h);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  // A section rather than a div because only a named region may carry an
  // aria-label, which is how the mission code view names itself too.
  //
  // Plain until shiki lands, and permanently if it fails to load. The text is
  // the point and the colour is not, so there is nothing to wait for.
  if (html === null) {
    return (
      <section aria-label={label} className={cn(PLAIN, className)}>
        <pre>{code}</pre>
      </section>
    );
  }
  return (
    <section
      aria-label={label}
      className={cn(HIGHLIGHTED, className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output of bytes we already hold
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
