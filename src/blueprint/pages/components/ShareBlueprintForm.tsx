/**
 * "Share this blueprint" (issue #1439): a pasteable code, a `coilbox://` link, a
 * `.json` file and a publish to the Coilbox hub. The four routes every other
 * shareable kind already offers, through the same component they offer them
 * through.
 *
 * Before this a layout could not leave coilbox at all. The container kind, the
 * hub row and the hub's preview of a layout all existed, and the only way to
 * produce one was to call the encoder from a test.
 *
 * What travels is the stored payload itself rather than a fresh export of the
 * layout. The library keeps the wire shape, footprints included, so this is
 * wrapping what is already on disk. That matters for a layout whose game is no
 * longer installed here: rebuilding the footprints would need a unitsync read
 * that cannot happen, and the layout would go out flattened to one square per
 * building, which is exactly the picture the hub would then draw of it.
 */

import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { Download } from "lucide-react";
import { useState } from "react";

import { ChallengeCodeView } from "@/challenge/ChallengeCodeView";
import { ErrorBanner } from "@/content/pages/components/states";
import { appFileIO } from "../../fileIO";
import type { StoredBlueprint } from "../../library";
import { encodePayloadCode, encodePayloadJson } from "../../transfer";

export function ShareBlueprintForm({ record }: { record: StoredBlueprint }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveFile = async () => {
    const dest = await save({
      title: "Export blueprint",
      defaultPath: `${record.layout.name || "blueprint"}.json`,
      filters: [{ name: "Coilbox blueprint", extensions: ["json"] }],
    });
    if (!dest) return;
    await appFileIO.write(dest, encodePayloadJson(record.layout));
  };

  const exportFile = async () => {
    setError(null);
    setBusy(true);
    try {
      await saveFile();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const code = encodePayloadCode(record.layout);
  if (code.ok) {
    return (
      <ChallengeCodeView
        code={code.code}
        helpText="Anyone who pastes this into Blueprints → Import gets this layout, and coilbox tells them there whether their game has the units it names."
        onExportFile={saveFile}
      />
    );
  }

  // The refusal, shown instead of a code and never alongside one: a code the far
  // end cannot inflate must not be copyable, or it ends up pasted somewhere
  // nobody can take it back from. A layout has to be improbably large to get
  // here, so this is the file route on its own rather than a dead end.
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">{code.message}</p>
      {error && <ErrorBanner message={error} />}
      <Button onClick={exportFile} disabled={busy}>
        <Download className="mr-1.5 size-4" aria-hidden />
        {busy ? "Exporting…" : "Export as file"}
      </Button>
    </div>
  );
}
