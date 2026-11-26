import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HelpPopover } from "@/components/HelpPopover";
import { SettingList, SettingRow } from "@/components/SettingRow";
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
  // True until the check on open has read the stored program's version again.
  const [checking, setChecking] = useState(true);
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
        setChecking(false);
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
    setError(null);
    try {
      const picked = await open({
        directory: false,
        multiple: false,
        title: t`Select the Open Annihilation program`,
        defaultPath: program?.path,
      });
      if (typeof picked !== "string") return;
      setBusy(true);
      setProgram(await playOaCheck({ path: picked }));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-semibold">
          <Trans>Program</Trans>
        </h2>
        <HelpPopover label={t`About the Open Annihilation program`}>
          <p>
            <Trans>
              Coilbox looks for Open Annihilation where its installer puts it.
              If yours is somewhere else, choose the open-annihilation file.
            </Trans>
          </p>
          <p>
            <Trans>
              Open Annihilation updates itself, so Coilbox reads its version
              again each time you open this page.
            </Trans>
          </p>
        </HelpPopover>
      </div>
      <SettingList>
        <SettingRow
          label={t`Location`}
          description={
            <span
              id="oa-program-path"
              className={
                program ? "select-text break-words font-mono" : undefined
              }
            >
              {program?.path ?? t`Not set`}
            </span>
          }
          error={error}
        >
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={find}
              disabled={busy}
            >
              <Search /> <Trans>Find</Trans>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={choose}
              disabled={busy}
            >
              <FolderOpen /> <Trans>Choose</Trans>
            </Button>
          </div>
        </SettingRow>
        {program && (
          <SettingRow label={t`Version`}>
            <span className="select-text text-sm">
              {checking ? t`Checking…` : program.version}
            </span>
          </SettingRow>
        )}
      </SettingList>
    </section>
  );
}
