import { FileQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import type { ArchiveFileResult } from "../../bindings";
import { formatBytes } from "../../format";

/** Extension -> shiki language id; anything unmapped renders as plain text. */
const LANG: Record<string, string> = {
  lua: "lua",
  json: "json",
  xml: "xml",
  html: "html",
  css: "css",
  js: "javascript",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  glsl: "glsl",
  h: "c",
  bos: "c",
  // Spring's TDF-family config files are INI-shaped enough to read well as INI.
  cfg: "ini",
  ini: "ini",
  tdf: "ini",
  fbi: "ini",
  smd: "ini",
  gui: "ini",
};

function langFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANG[ext] ?? "text";
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Syntax-highlight `code` with shiki (lazy-loaded); plain `<pre>` until ready. */
function TextPreview({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    import("shiki")
      .then(({ codeToHtml }) =>
        codeToHtml(code, { lang, theme: "github-dark" }),
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

  if (html) {
    return (
      <div
        // shiki emits a styled <pre>; reset its margins and pad uniformly.
        className="h-full overflow-auto rounded-lg border border-border/50 text-xs [&_pre]:!m-0 [&_pre]:min-h-full [&_pre]:!p-3"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output of our own archive bytes
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className="h-full overflow-auto rounded-lg border border-border/50 bg-card p-3 font-mono text-xs">
      {code}
    </pre>
  );
}

/**
 * Preview the selected archive member: highlighted text, an inline image, or a
 * metadata-only notice for binary / too-large files.
 */
export function FilePreview({
  path,
  result,
  loading,
}: {
  path: string | null;
  result: ArchiveFileResult | null;
  loading: boolean;
}) {
  if (!path) {
    return (
      <Centered>
        <FileQuestion className="size-6" />
        Select a file to preview it.
      </Centered>
    );
  }
  if (loading) {
    return (
      <div className="h-full min-h-40 animate-pulse rounded-lg border border-border/50 bg-card" />
    );
  }
  if (!result) {
    return <Centered>Could not read this file.</Centered>;
  }
  if (result.kind === "text" && result.text != null) {
    return <TextPreview code={result.text} lang={langFor(path)} />;
  }
  if (result.kind === "image" && result.dataUrl) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto rounded-lg border border-border/50 bg-[repeating-conic-gradient(theme(colors.muted.DEFAULT)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-3">
        <img
          src={result.dataUrl}
          alt={path}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }
  return (
    <Centered>
      <FileQuestion className="size-6" />
      {result.truncated
        ? `Too large to preview (${formatBytes(result.size)}).`
        : `No preview for this file type (${formatBytes(result.size)}).`}
    </Centered>
  );
}
