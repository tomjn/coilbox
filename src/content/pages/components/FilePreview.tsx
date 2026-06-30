import { Button } from "@picoframe/frame";
import { Check, Copy, Download, FileQuestion } from "lucide-react";
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

/** The selected member's contents: highlighted text, an inline image, or a
 * metadata-only notice for binary / too-large files. */
function PreviewBody({
  path,
  result,
  loading,
}: {
  path: string;
  result: ArchiveFileResult | null;
  loading: boolean;
}) {
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

/** Filename plus the copy/download actions for the selected member. */
function PreviewToolbar({
  path,
  result,
  onDownload,
}: {
  path: string;
  result: ArchiveFileResult | null;
  onDownload: () => Promise<boolean>;
}) {
  const base = path.split("/").pop() ?? path;
  const text = result?.kind === "text" ? result.text : undefined;
  const [copied, setCopied] = useState(false);
  const [dl, setDl] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const copy = async () => {
    if (text == null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; the preview text is still selectable.
    }
  };

  const download = async () => {
    setDl("saving");
    try {
      const saved = await onDownload();
      setDl(saved ? "saved" : "idle");
      if (saved) setTimeout(() => setDl("idle"), 1500);
    } catch (e) {
      console.error("archive member download failed", e);
      setDl("error");
      setTimeout(() => setDl("idle"), 2500);
    }
  };

  const dlLabel =
    dl === "saving"
      ? "Saving"
      : dl === "saved"
        ? "Saved"
        : dl === "error"
          ? "Failed"
          : "Download";

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
        title={path}
      >
        {base}
      </span>
      {text != null && (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={copy}>
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={download}
        disabled={dl === "saving"}
      >
        <Download className="size-3.5" /> {dlLabel}
      </Button>
    </div>
  );
}

/**
 * Preview the selected archive member with a toolbar to copy (text) or download
 * (any file) it. Shows a prompt when nothing is selected.
 */
export function FilePreview({
  path,
  result,
  loading,
  onDownload,
}: {
  path: string | null;
  result: ArchiveFileResult | null;
  loading: boolean;
  onDownload: () => Promise<boolean>;
}) {
  if (!path) {
    return (
      <Centered>
        <FileQuestion className="size-6" />
        Select a file to preview it.
      </Centered>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PreviewToolbar path={path} result={result} onDownload={onDownload} />
      <div className="min-h-0 flex-1">
        <PreviewBody path={path} result={result} loading={loading} />
      </div>
    </div>
  );
}
