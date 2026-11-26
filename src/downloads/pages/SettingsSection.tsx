import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input, useSetting } from "@picoframe/frame";
import { Plus, Trash2 } from "lucide-react";
import { HelpPopover } from "@/components/HelpPopover";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HubAddressField } from "../../hub/pages/components/HubAddressField";
import { AUTO_DOWNLOAD_ON_JOIN_KEY } from "../../multiplayer/battle/autoDownload";
import { isHubEnabled } from "../../profile/profile";
import { useArchiveInstallSettings, useDownloadsConfig } from "../config";

/**
 * Settings > Library > Sources (frame settings page at `/settings/sources`,
 * issue #4584). Four concerns, all persisted immediately (no Save button):
 *  - the list of rapid masters offered on the Rapid repositories page
 *  - whether joining a battle fetches missing content on its own (issue #439)
 *  - what a game or map archive dropped on the window does: ask first or not,
 *    and keep or delete the original
 *  - which Coilbox hub to read, while the hub is on
 *
 * Where downloads are written is not here. It is chosen beside the folders
 * themselves, in the content plugin's Content folders page.
 *
 * The auto-download opt-out was a settings page of its own holding one switch,
 * which is not a page. It reads the multiplayer plugin's setting key, so the
 * behaviour stays with the battle code that acts on it and only the control
 * lives here, next to the other answers to "what does downloading do".
 *
 * Engine downloads live in the content plugin's Engines settings page (below the
 * engine list).
 */
export default function DownloadsSettings() {
  const { t } = useLingui();
  const [cfg, setCfg] = useDownloadsConfig();
  const [autoOnJoin, setAutoOnJoin] = useSetting<boolean>(
    AUTO_DOWNLOAD_ON_JOIN_KEY,
    true,
  );
  const archive = useArchiveInstallSettings();

  const addRepo = () =>
    setCfg({
      ...cfg,
      rapidRepos: [
        ...cfg.rapidRepos,
        { id: crypto.randomUUID(), name: "", url: "" },
      ],
    });
  const updateRepo = (id: string, key: "name" | "url", value: string) =>
    setCfg({
      ...cfg,
      rapidRepos: cfg.rapidRepos.map((r) =>
        r.id === id ? { ...r, [key]: value } : r,
      ),
    });
  const removeLabel = (r: { name: string; url: string }) => {
    const repoName = r.name || r.url || t`repository`;
    return t`Remove ${repoName}`;
  };
  const removeRepo = (id: string) =>
    setCfg({ ...cfg, rapidRepos: cfg.rapidRepos.filter((r) => r.id !== id) });

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold">
              <Trans>Rapid repositories</Trans>
            </h2>
            <HelpPopover label={t`About rapid repositories`}>
              <p>
                <Trans>
                  A rapid repository lists games and their versions. The Rapid
                  repositories page in Library browses and downloads from the
                  ones here, and game updates are looked up in them.
                </Trans>
              </p>
            </HelpPopover>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addRepo}>
            <Plus /> <Trans>Add repository</Trans>
          </Button>
        </div>
        {cfg.rapidRepos.length === 0 ? (
          <p className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
            <Trans>No rapid repositories.</Trans>
          </p>
        ) : (
          <TooltipProvider>
            <ul className="divide-y divide-border rounded-md border border-border">
              {cfg.rapidRepos.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-4 py-2">
                  <Input
                    value={r.name}
                    onChange={(e) => updateRepo(r.id, "name", e.target.value)}
                    placeholder={t`Name`}
                    aria-label={t`Name`}
                    className="min-w-0 flex-1"
                  />
                  <Input
                    value={r.url}
                    onChange={(e) => updateRepo(r.id, "url", e.target.value)}
                    placeholder="https://repos.example.org"
                    aria-label={t`Master URL`}
                    className="min-w-0 flex-[2] font-mono text-xs"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRepo(r.id)}
                        aria-label={removeLabel(r)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <Trans>Remove</Trans>
                    </TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </TooltipProvider>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          <Trans>Downloading</Trans>
        </h2>
        <SettingList>
          <SettingRow
            id="auto-download-on-join"
            label={t`Download missing content when joining a battle`}
            help={
              <p>
                <Trans>
                  When you join a battle whose game or map you don't have, the
                  download starts straight away instead of waiting for a click.
                  The Download button stays available to pause or retry.
                </Trans>
              </p>
            }
            helpLabel={t`About downloading when joining`}
          >
            <Switch
              id="auto-download-on-join"
              checked={autoOnJoin}
              onCheckedChange={setAutoOnJoin}
            />
          </SettingRow>
          <SettingRow
            id="archive-no-prompt"
            label={t`Install dropped archives without asking`}
            help={
              <p>
                <Trans>
                  A game or map archive dropped on the window, or opened with
                  Coilbox, is copied to where new downloads go.
                </Trans>
              </p>
            }
            helpLabel={t`About dropped archives`}
          >
            <Switch
              id="archive-no-prompt"
              checked={archive.noPrompt}
              onCheckedChange={archive.setNoPrompt}
            />
          </SettingRow>
          <SettingRow
            id="archive-move"
            label={t`Delete dropped archives once installed`}
          >
            <Switch
              id="archive-move"
              checked={archive.move}
              onCheckedChange={archive.setMove}
            />
          </SettingRow>
        </SettingList>
      </section>

      {/* The hub, unless the profile has switched it off */}
      {isHubEnabled() && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">
            <Trans>Coilbox hub</Trans>
          </h2>
          <HubAddressField />
        </section>
      )}
    </div>
  );
}
