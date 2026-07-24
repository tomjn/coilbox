import { Button } from "@picoframe/frame";
import { Check, Copy, Download, Link as LinkIcon } from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { buildImportCodeLink } from "@/deeplink/build";
import { copyDeepLink } from "@/deeplink/copyLink";
import { ErrorBanner } from "../content/pages/components/states";

/**
 * Read-only display of a challenge or setup-pack code with a copy button -
 * the "Share challenge"/"Share pack" drawer content (issue #376). Also offers
 * a "Copy link" action that wraps the same code as a `coilbox://import?code=`
 * link (issue #498), for pasting somewhere a raw code would be mistaken for
 * noise - the link is an addition alongside the raw-code copy, not a
 * replacement for it.
 *
 * `onExportFile` (issue #476) adds a third action that saves the container as
 * a `.json` file instead, for larger payloads or where pasting a long code is
 * awkward. It's optional so callers that only ever produce a code (setup
 * packs, today) don't gain a button with nothing behind it - the caller owns
 * the save dialog and the actual write, this component only surfaces busy and
 * error state around it.
 */
export function ChallengeCodeView({
  code,
  helpText,
  onExportFile,
}: {
  code: string;
  helpText: string;
  /** Save the challenge as a file. Resolves once the dialog is dismissed
   * (including a no-op resolve when the user cancels it). */
  onExportFile?: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable, so the code is still selectable in the box.
    }
  };

  const exportFile = async () => {
    if (!onExportFile) return;
    setFileError(null);
    setFileBusy(true);
    try {
      await onExportFile();
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      setFileBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">{helpText}</p>
      <Textarea
        readOnly
        value={code}
        rows={6}
        className="font-mono text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      {fileError && <ErrorBanner message={fileError} />}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={copy}>
          {copied ? (
            <>
              <Check className="mr-1.5 size-4" aria-hidden /> Copied
            </>
          ) : (
            <>
              <Copy className="mr-1.5 size-4" aria-hidden /> Copy code
            </>
          )}
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => copyDeepLink(buildImportCodeLink(code))}
        >
          <LinkIcon className="mr-1.5 size-4" aria-hidden /> Copy link
        </Button>
      </div>
      {onExportFile && (
        <Button variant="outline" onClick={exportFile} disabled={fileBusy}>
          <Download className="mr-1.5 size-4" aria-hidden />
          {fileBusy ? "Exporting…" : "Export as file"}
        </Button>
      )}
    </div>
  );
}
