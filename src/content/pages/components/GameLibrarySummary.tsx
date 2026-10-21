import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Download, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/format";
import { versionLabel } from "@/lib/utils";
import type { DownloadRecord } from "../../../downloads/downloadHistory";
import type { GameItem } from "../../bindings";
import { shortMd5 } from "../../gameVersionRows";
import type { LibraryGame } from "../../library";

/** Brand and service names stay as they are; only the two generic ones read. */
function sourceLabel(
  source: DownloadRecord["source"],
  t: ReturnType<typeof useLingui>["t"],
): string {
  switch (source) {
    case "url":
      return t`a direct download`;
    case "file":
      return t`a file`;
    case "github":
      return "GitHub";
    default:
      return source;
  }
}

const dateOf = (iso: string) =>
  formatDate(new Date(iso), { dateStyle: "medium" });

/** What the newest successful download fetched, in a few words. */
function fetchedOf(r: DownloadRecord): string | null {
  if (r.source === "rapid" || r.source === "github") return r.reference;
  return r.filename;
}

/**
 * The library facts under the game page's banner (issue #4580): the installed
 * version and where it came from, the update on offer, the hub's counts, the
 * engine the page reads the game with, and the switch that turns this game's
 * updates off.
 */
export function GameLibrarySummary({
  game,
  record,
  installedFrom,
  engine,
  updatesOn,
  onUpdatesChange,
  canUpdate,
  updating,
  onUpdate,
}: {
  game: GameItem;
  record: LibraryGame | undefined;
  /** The newest download of the game that worked. */
  installedFrom: DownloadRecord | null;
  /** The version of the engine the page reads the game with. */
  engine: string | undefined;
  updatesOn: boolean;
  onUpdatesChange: (on: boolean) => void;
  canUpdate: boolean;
  updating: boolean;
  onUpdate: () => void;
}) {
  const { t } = useLingui();
  const version = game.info.version ? versionLabel(game.info.version) : null;
  const fetched = installedFrom && fetchedOf(installedFrom);
  const update = record?.update;
  const rapid = record?.rapidUpdate;
  const updateName = update
    ? update.version
      ? versionLabel(update.version)
      : (update.tag ?? update.filename)
    : "";
  const updateVia = update?.kind === "github" ? "GitHub" : update?.kind;
  const rapidPackage = rapid ? shortMd5(rapid.md5) : "";
  const rapidTag = rapid?.tag;
  const offer = update
    ? t`${updateName} via ${updateVia}`
    : rapid
      ? t`package ${rapidPackage} via ${rapidTag}`
      : null;
  const hub = record?.hub;
  const installedName = version ?? game.name;
  const installedSource = installedFrom
    ? sourceLabel(installedFrom.source, t)
    : "";
  const installedOn = installedFrom ? dateOf(installedFrom.at) : "";
  const factions = hub
    ? plural(hub.faction_count, { one: "# faction", other: "# factions" })
    : "";
  const units = hub
    ? plural(hub.unit_count, { one: "# unit", other: "# units" })
    : "";

  return (
    <section
      aria-label={t`Library`}
      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/50 bg-card p-3 text-sm"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">
          <Trans>Installed</Trans>
        </dt>
        <dd>
          {installedFrom ? (
            fetched ? (
              <Trans>
                {installedName} from {installedSource}{" "}
                <span className="font-mono text-xs">{fetched}</span> on{" "}
                {installedOn}
              </Trans>
            ) : (
              <Trans>
                {installedName} from {installedSource} on {installedOn}
              </Trans>
            )
          ) : (
            installedName
          )}
        </dd>
        {offer && (
          <>
            <dt className="text-muted-foreground">
              <Trans>Update</Trans>
            </dt>
            <dd>{offer}</dd>
          </>
        )}
        {hub && (
          <>
            <dt className="text-muted-foreground">
              <Trans>Hub</Trans>
            </dt>
            <dd>
              <Trans>
                {factions} · {units}
              </Trans>
            </dd>
          </>
        )}
        {engine && (
          <>
            <dt className="text-muted-foreground">
              <Trans>Engine</Trans>
            </dt>
            <dd>{engine}</dd>
          </>
        )}
      </dl>
      <div className="flex flex-col items-end gap-2">
        {offer && (
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={!canUpdate || updating}
            onClick={onUpdate}
          >
            {updating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            <Trans>Update</Trans>
          </Button>
        )}
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Switch checked={updatesOn} onCheckedChange={onUpdatesChange} />
          <Trans>Show updates</Trans>
        </Label>
      </div>
    </section>
  );
}
