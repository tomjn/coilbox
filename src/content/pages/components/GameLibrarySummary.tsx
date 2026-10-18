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

const SOURCE_LABEL: Record<DownloadRecord["source"], string> = {
  rapid: "rapid",
  github: "GitHub",
  springfiles: "springfiles",
  hakora: "hakora",
  evolutionrts: "evolutionrts",
  url: "a direct download",
  file: "a file",
};

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
  const version = game.info.version ? versionLabel(game.info.version) : null;
  const fetched = installedFrom && fetchedOf(installedFrom);
  const update = record?.update;
  const rapid = record?.rapidUpdate;
  const offer = update
    ? `${update.version ? versionLabel(update.version) : (update.tag ?? update.filename)} via ${update.kind === "github" ? "GitHub" : update.kind}`
    : rapid
      ? `package ${shortMd5(rapid.md5)} via ${rapid.tag}`
      : null;
  const hub = record?.hub;

  return (
    <section
      aria-label="Library"
      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/50 bg-card p-3 text-sm"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Installed</dt>
        <dd>
          {version ?? game.name}
          {installedFrom && (
            <>
              {" "}
              from {SOURCE_LABEL[installedFrom.source]}
              {fetched && <span className="font-mono text-xs"> {fetched}</span>}{" "}
              on {dateOf(installedFrom.at)}
            </>
          )}
        </dd>
        {offer && (
          <>
            <dt className="text-muted-foreground">Update</dt>
            <dd>{offer}</dd>
          </>
        )}
        {hub && (
          <>
            <dt className="text-muted-foreground">Hub</dt>
            <dd>
              {hub.faction_count} faction{hub.faction_count === 1 ? "" : "s"} ·{" "}
              {hub.unit_count} unit{hub.unit_count === 1 ? "" : "s"}
            </dd>
          </>
        )}
        {engine && (
          <>
            <dt className="text-muted-foreground">Engine</dt>
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
            Update
          </Button>
        )}
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Switch checked={updatesOn} onCheckedChange={onUpdatesChange} />
          Show updates
        </Label>
      </div>
    </section>
  );
}
