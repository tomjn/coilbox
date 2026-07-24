import { Button } from "@picoframe/frame";
import { Download, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "../content/pages/components/states";

/**
 * A paste-in box for a base64url code plus an Import action. Started as the
 * "Import challenge" drawer content shared by conquest and warpath (issue
 * #376). `placeholder`/`submitLabel` let other base64url formats reuse it
 * without the wording claiming to be a "challenge" (setup packs, issue #415).
 * `onImport` does the actual decode/apply/save. This component only owns the
 * textbox, the busy state and surfacing whatever error it throws.
 *
 * `onPickFile` (issue #476) adds a "browse a file" action alongside the paste
 * box: the caller opens the native dialog and reads the chosen file's text
 * (or `null` if cancelled), which this component then feeds through the exact
 * same `submit`/`onImport` path as a manual paste - a file's raw JSON decodes
 * through the same `decodeChallenge` as a pasted code, so no separate import
 * path is needed. Optional so callers that only ever accept a pasted code
 * (setup packs, today) don't gain a button with nothing behind it.
 */
export function ChallengeCodeInput({
  helpText,
  placeholder = "Paste a challenge code…",
  submitLabel = "Import challenge",
  busyLabel = "Importing…",
  fileButtonLabel = "Import from file…",
  initialCode,
  onImport,
  onPickFile,
}: {
  helpText: string;
  placeholder?: string;
  submitLabel?: string;
  busyLabel?: string;
  fileButtonLabel?: string;
  /** A code to prefill and submit once on mount, used by a `coilbox://` import
   * deep link (issue #388) that has already been confirmed. The user still sees
   * the code and the import runs through the same decode plus content-resolution
   * path as a manual paste. */
  initialCode?: string;
  onImport: (code: string) => Promise<void>;
  /** Open a native file dialog and return the chosen file's text, or `null` if
   * the dialog was cancelled. */
  onPickFile?: () => Promise<string | null>;
}) {
  const [code, setCode] = useState(initialCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (value: string = code) => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onImport(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async () => {
    if (!onPickFile) return;
    setError(null);
    try {
      const text = await onPickFile();
      if (text === null) return;
      setCode(text);
      await submit(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Auto-submit a deep-link-supplied code once. Guarded so a re-render never
  // re-fires it, and so editing the box afterwards behaves like a manual paste.
  const autoFired = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires exactly once for the initial code, not on every submit identity change
  useEffect(() => {
    if (initialCode && !autoFired.current) {
      autoFired.current = true;
      void submit(initialCode);
    }
  }, [initialCode]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">{helpText}</p>
      <Textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={placeholder}
        rows={6}
        className="font-mono text-xs"
      />
      {error && <ErrorBanner message={error} />}
      <Button onClick={() => submit()} disabled={busy || !code.trim()}>
        <Download className="mr-1.5 size-4" aria-hidden />
        {busy ? busyLabel : submitLabel}
      </Button>
      {onPickFile && (
        <Button variant="outline" onClick={pickFile} disabled={busy}>
          <FolderOpen className="mr-1.5 size-4" aria-hidden />
          {fileButtonLabel}
        </Button>
      )}
    </div>
  );
}
