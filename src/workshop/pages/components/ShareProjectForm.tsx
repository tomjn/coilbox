/**
 * "Share this project" (issue #2727): a pasteable code, a `coilbox://` link, a
 * `.json` file and a publish to the Coilbox hub. The same four routes every
 * other shareable kind offers, through `ShareBlueprintForm`'s pattern: a code
 * when the project fits in one, `PublishSection` riding along inside
 * `ChallengeCodeView` for free.
 *
 * The container side already existed (`mod-project` is a real container kind,
 * `sniffPayloadKind` recognises one, a shared link opens on the projects
 * list). What was missing was this form and `mod-project` joining
 * `HUB_KINDS` in `src/hub/api.ts`, so publishing did not 400 on every listing
 * filter that named it.
 */

import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { Download } from "lucide-react";
import { useState } from "react";

import { ChallengeCodeView } from "@/challenge/ChallengeCodeView";
import type { InstalledGameInfo } from "@/container/gameIdentity";
import { contentWriteFile } from "@/content/bindings";
import { ErrorBanner } from "@/content/pages/components/states";
import {
  type ModProject,
  modProjectCode,
  modProjectFileName,
  modProjectJson,
} from "../../project";

export function ShareProjectForm({
  project,
  installed,
}: {
  project: ModProject;
  installed: readonly InstalledGameInfo[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveFile = async () => {
    const dest = await save({
      title: "Export tweak project",
      defaultPath: modProjectFileName(project),
      filters: [{ name: "Coilbox tweak project", extensions: ["json"] }],
    });
    if (!dest) return;
    await contentWriteFile({
      dest,
      text: modProjectJson(project, installed),
    });
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

  const code = modProjectCode(project, installed);
  if (code.ok) {
    return (
      <ChallengeCodeView
        code={code.code}
        helpText="Anyone who pastes this into Unit tweaks → Import gets this project, opened against the game it names."
        onExportFile={saveFile}
      />
    );
  }

  // The refusal, shown instead of a code and never alongside one: a code the
  // far end cannot inflate must not be copyable, or it ends up pasted
  // somewhere nobody can take it back from. A project holds whole unit
  // definitions once it has copies in it, so this is the file route on its
  // own rather than a dead end.
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">
        {`"${project.name}" is ${Math.round(code.length / 1024)} KB, over the ${Math.round(code.limit / 1024)} KB a code can carry. Export it as a file instead.`}
      </p>
      {error && <ErrorBanner message={error} />}
      <Button onClick={exportFile} disabled={busy}>
        <Download className="mr-1.5 size-4" aria-hidden />
        {busy ? "Exporting…" : "Export as file"}
      </Button>
    </div>
  );
}
