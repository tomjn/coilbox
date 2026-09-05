import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { identify } from "../container/container";
import { rememberCarriedShortname } from "../container/shortnames";
import { ResolveContentGate } from "../content/pages/components/ResolveContentDrawer";
import type { ContentRequirement } from "../content/resolveContent";
import { notify } from "../notify/notify";
import type { PlayTarget } from "../play/config";
import { usePreferredTarget } from "../play/config";
import { challengeImport } from "./bindings";
import { ChallengeCodeInput } from "./ChallengeCodeInput";
import {
  type ChallengeDecodeResult,
  challengeDecodeErrorMessage,
} from "./code";

/**
 * Paste a challenge code, resolve it against the recipient's own install, and
 * generate the identical thing locally (issue #376), offering to download the
 * challenge's game first if it isn't installed (issue #387). Shared by
 * conquest's `ConquestListPage.tsx` and warpath's `ImportChallengeForm.tsx`
 * (issue #2441): both wrap this with their own `decode` and `finish`, which is
 * where a galaxy and a run genuinely stop looking alike (branding and map
 * names for one, a commander build graph and a skirmish AI pick for the
 * other).
 */
export function ImportChallengeForm<TSettings, TDoc>({
  helpText,
  /** What a substituted map replaced, for the notify body, e.g. "systems" or
   * "encounters" (issue #1393). */
  substitutedNoun,
  initialCode,
  decode,
  buildRequirement,
  finish,
  countSubstitutedMaps,
  onImported,
}: {
  helpText: string;
  substitutedNoun: string;
  /** A confirmed `coilbox://` import code to prefill and run once (issue #388). */
  initialCode?: string;
  decode: (code: string) => ChallengeDecodeResult<TSettings>;
  /** Best-effort match for the resolve gate (issue #387). */
  buildRequirement: (settings: TSettings) => ContentRequirement;
  /** Resolve the installed game, generate, save, and return the new id plus
   * the saved doc (for the substituted-map count below). Throws to report a
   * missing install or a generation failure back through the drawer. */
  finish: (
    settings: TSettings,
    target: PlayTarget,
  ) => Promise<{ id: string; doc: TDoc }>;
  countSubstitutedMaps: (doc: TDoc) => number;
  onImported: (id: string) => void;
}) {
  const { target, loading: targetLoading } = usePreferredTarget();
  const [pending, setPending] = useState<TSettings | null>(null);

  const runFinish = async (settings: TSettings) => {
    if (!target) throw new Error("Install an engine first.");
    const { id, doc } = await finish(settings, target);
    // Say so when this install could not supply every map the challenge names
    // (issue #1393). This is the one moment somebody is watching, and a
    // stand-in they never heard about is exactly the surprise the naming
    // exists to stop.
    const substituted = countSubstitutedMaps(doc);
    if (substituted > 0) {
      void notify({
        title: `Imported with ${substituted} substituted ${substituted === 1 ? "map" : "maps"}`,
        body: `You do not have every map this challenge names. Those ${substitutedNoun} say which map they should have used.`,
      });
    }
    onImported(id);
  };

  // Decode the code, then either finish straight away (game already
  // installed, no pointless prompt) or hand off to the resolve gate, which
  // offers the download and calls `runFinish` once it clears (#387).
  const importChallenge = async (code: string) => {
    const result = decode(code);
    if (!result.ok) {
      throw new Error(challengeDecodeErrorMessage(result.error));
    }
    // A challenge that pins a build names it both ways, so take its word for
    // the shortname (issue #1383). One that pins none teaches nothing.
    rememberCarriedShortname(identify(code).game);
    setPending(result.settings);
  };

  // Open a challenge file exported alongside the code (#476), the rest of the
  // import (decode, resolve, generate) is identical to a pasted code.
  const pickChallengeFile = async (): Promise<string | null> => {
    const src = await open({
      title: "Import challenge",
      multiple: false,
      filters: [{ name: "Coilbox challenge", extensions: ["json"] }],
    });
    if (typeof src !== "string") return null;
    const { text } = await challengeImport({ src });
    return text;
  };

  return (
    <>
      <ChallengeCodeInput
        helpText={helpText}
        initialCode={initialCode}
        onImport={importChallenge}
        onPickFile={pickChallengeFile}
      />
      {pending && (
        <ResolveContentGate
          title="Set up this challenge"
          requirements={[buildRequirement(pending)]}
          target={target ?? undefined}
          targetLoading={targetLoading}
          onContinue={() => runFinish(pending).then(() => setPending(null))}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
