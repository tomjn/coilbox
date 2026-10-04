import { useMemo } from "react";
import { ChallengeRecordLine } from "./ChallengeRecordLine";
import type { ChallengeDecodeResult } from "./code";
import { codeFromPaste } from "./record";

/**
 * Under the import box: your own best result for the code that is pasted there,
 * once it decodes. Nothing for text that is not a code, or a code with no record.
 *
 * Only the code is read. A sharer's line of text under it is dropped, so their
 * claim is never shown here.
 */
export function ImportedCodeRecord<TSettings>({
  code,
  decode,
  identityOf,
}: {
  code: string;
  decode: (code: string) => ChallengeDecodeResult<TSettings>;
  identityOf: (settings: TSettings) => string;
}) {
  const result = useMemo(
    () => (code.trim() ? decode(codeFromPaste(code)) : null),
    [code, decode],
  );
  if (!result?.ok) return null;
  return <ChallengeRecordLine identity={identityOf(result.settings)} />;
}
