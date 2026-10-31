import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, FolderOpen, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/Field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { describeError } from "@/i18n/uiError";
import { playOaCheck, playOaFind } from "../../play/bindings";
import { useOpenAnnihilation } from "../openAnnihilation";

/**
 * Settings section for the Open Annihilation program (issue #4943). It holds the
 * path and the version line the program printed. The path fills itself from
 * OA's usual install location when there is one, and otherwise the player picks
 * the file. A path is stored only after the program ran and printed an OA
 * version, so a refused pick leaves the setting as it was.
 */
export default function OpenAnnihilationSettings() {
  const { t } = useLingui();
  const [program, setProgram] = useOpenAnnihilation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  // Once, when the section opens: fill an empty setting from the usual install
  // location, or read the version of the stored program again, because OA
  // updates itself and the line stored when it was chosen goes stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on open, not on each change to the setting it writes
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      setBusy(true);
      try {
        if (program) {
          const fresh = await playOaCheck({ path: program.path });
          if (fresh.version !== program.version) setProgram(fresh);
        } else {
          const { found } = await playOaFind({});
          if (found) setProgram(found);
        }
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const find = async () => {
    setBusy(true);
    setError(null);
    try {
      const { found } = await playOaFind({});
      if (found) {
        setProgram(found);
      } else {
        setError(
          t`Open Annihilation is not in its usual place. Choose the open-annihilation file instead.`,
        );
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    const picked = await open({
      directory: false,
      multiple: false,
      title: t`Select the Open Annihilation program`,
      defaultPath: program?.path,
    });
    if (typeof picked !== "string") return;
    setBusy(true);
    setError(null);
    try {
      setProgram(await playOaCheck({ path: picked }));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Not a Field: its label would wrap the buttons, and a click on a
          button inside a label is also a click on the label. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="oa-program" className="font-medium leading-none">
          <Trans>Program</Trans>
        </Label>
        <div className="flex gap-2">
          <Input
            id="oa-program"
            value={program?.path ?? ""}
            readOnly
            placeholder={t`(none)`}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            onClick={choose}
            disabled={busy}
            className="shrink-0"
          >
            <FolderOpen /> <Trans>Choose</Trans>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={find}
            disabled={busy}
            className="shrink-0"
          >
            <Search /> <Trans>Find</Trans>
          </Button>
        </div>
      </div>
      {program && (
        <Field label={t`Version`}>
          <Input
            value={program.version}
            readOnly
            className="font-mono text-xs"
          />
        </Field>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
