import { Button } from "@picoframe/frame";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";

/**
 * Read-only display of a challenge code with a copy button — the "Share
 * challenge" drawer content, shared by conquest and warpath (issue #376).
 */
export function ChallengeCodeView({
  code,
  helpText,
}: {
  code: string;
  helpText: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; the code is still selectable in the box.
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
      <Button onClick={copy}>
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
    </div>
  );
}
