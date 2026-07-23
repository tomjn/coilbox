import { Button } from "@picoframe/frame";
import { Download } from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "../content/pages/components/states";

/**
 * A paste-in box for a challenge code plus an Import action — the "Import
 * challenge" drawer content, shared by conquest and warpath (issue #376).
 * `onImport` does the actual decode/generate/save; this component only owns
 * the textbox, the busy state and surfacing whatever error it throws.
 */
export function ChallengeCodeInput({
  helpText,
  busyLabel = "Importing…",
  onImport,
}: {
  helpText: string;
  busyLabel?: string;
  onImport: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onImport(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">{helpText}</p>
      <Textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Paste a challenge code…"
        rows={6}
        className="font-mono text-xs"
      />
      {error && <ErrorBanner message={error} />}
      <Button onClick={submit} disabled={busy || !code.trim()}>
        <Download className="mr-1.5 size-4" aria-hidden />
        {busy ? busyLabel : "Import challenge"}
      </Button>
    </div>
  );
}
