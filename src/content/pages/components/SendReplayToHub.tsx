import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUp, ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { CoilboxGlyph } from "@/components/CoilboxGlyph";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useHubAccount } from "@/hub/account";
import { startReplayUpload } from "@/hub/archiveUploads";
import { useHubUrl } from "@/hub/config";
import { beginReplaySend, endManualSend } from "@/hub/manualSend/grant";
import { replayOnHub, useReplaysOnHub } from "@/hub/replaysOnHub";
import { describeUploadEnd } from "@/hub/upload/messages";
import {
  rememberUpload,
  uploadOf,
  useArchiveUploads,
} from "@/hub/upload/store";
import { describeError } from "@/i18n/uiError";
import { notify } from "@/notify/notify";
import { useLastLogin, useLobbyAccounts } from "../../../lobby-servers/config";
import type { DemoInfo } from "../../bindings";
import { signedInLobbyNames, userNameInReplay } from "../../replayHubName";
import { buildReplaySummary, type SummaryProblem } from "../../replaySummary";
import { useMatchStats } from "../../useMatchStats";
import { useReplayBuildOrders } from "../../useReplayBuildOrders";
import { useReplayUnits } from "../../useReplayUnits";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * "Send to hub" on a replay's page (issue #5493).
 *
 * Shown to a player signed in to the hub, for a replay of a battle they were
 * in: one of the lobby names they have signed in to Coilbox with is a player or
 * a spectator in it. Nothing is read until the panel opens, and nothing leaves
 * the machine until its Send button is pressed.
 *
 * The transfer belongs to the app, as an archive upload's does. The button
 * says how it is going: sending, waiting for the hub's check, on the hub with a
 * link, or not sent with the hub's reason in the panel.
 */
export function SendReplayToHub({
  info,
  replayPath,
}: {
  info: DemoInfo;
  replayPath: string;
}) {
  const { t } = useLingui();
  const hubUrl = useHubUrl();
  const account = useHubAccount(hubUrl);
  const [accounts] = useLobbyAccounts();
  const [lastLogin] = useLastLogin();
  const uploads = useArchiveUploads();
  const held = useReplaysOnHub();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const name = userNameInReplay(
    info,
    signedInLobbyNames(accounts.accounts, lastLogin),
  );
  const upload = uploadOf(uploads, hubUrl, "replay", fileName(replayPath));
  const known = replayOnHub(held, hubUrl, info.gameId);
  const running = upload !== undefined && upload.phase !== "done";
  const ending =
    upload?.phase === "done" && upload.outcome && upload.opId !== dismissed
      ? upload.outcome
      : null;
  const listedUrl =
    ending?.kind === "listed" ? (upload?.pageUrl ?? null) : null;
  const onHub = ending?.kind === "listed" || known !== undefined;

  // The reads the summary is made of, asked for only once the panel is open.
  const wanted = open && !onHub && !running;
  const stats = useMatchStats(wanted ? replayPath : null);
  const builds = useReplayBuildOrders(replayPath);
  const { load } = builds;
  useEffect(() => {
    if (wanted) load();
  }, [wanted, load]);
  const orders = builds.result;
  const units = useReplayUnits(
    info,
    wanted && orders !== null,
    "stream",
    orders?.unitNames,
  );

  if (!info.gameId || info.remixed || !name) return null;
  const gameId = info.gameId;
  const label = t`The replay on ${info.mapName}`;

  const icons = (text: string) => (
    <>
      <CoilboxGlyph size={16} />
      {text}
      <ArrowUp className="size-4" aria-hidden />
    </>
  );

  if (running) {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" disabled>
        {icons(
          upload.phase === "waiting"
            ? t`The hub is checking it…`
            : t`Sending to hub…`,
        )}
      </Button>
    );
  }

  if (onHub) {
    const url = listedUrl ?? known?.url ?? null;
    return (
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        disabled={!url}
        onClick={() => url && void openUrl(url).catch(() => {})}
      >
        <CoilboxGlyph size={16} />
        {t`On the hub`}
        <ExternalLink className="size-4" aria-hidden />
      </Button>
    );
  }

  // Only a signed in player can send, so nobody else is offered the button.
  if (!ending && !account.signedIn) return null;

  const problemText = (problem: SummaryProblem): string => {
    switch (problem.kind) {
      case "unfinished":
        return t`The recording stops before the end of the match, and the hub only takes a whole match.`;
      case "incompleteOrders":
        return t`Coilbox could not read every build order in this replay, and the hub checks all of them.`;
      case "noTeam":
        return t`The replay does not say which team ${problem.name} was on.`;
      case "unknownUnit":
        return t`Coilbox cannot say what every unit built in this match is or costs. Install the game it was played on, then try again.`;
    }
  };

  const failed = stats.error !== null || builds.failed;
  // A match with no build orders names no units, so it waits for nothing more.
  const unitsReady =
    orders?.orders.length === 0 ||
    (units.source !== null && units.status !== "loading");
  // Another version's ids can name the wrong unit, which the hub would refuse.
  const otherBuild = units.source?.kind === "differentBuild";
  const made =
    !failed && stats.data && orders && unitsReady && !otherBuild
      ? buildReplaySummary(
          info,
          stats.data.trailer,
          orders,
          units.described ?? [],
        )
      : null;

  const send = async () => {
    if (!made || !("summary" in made)) return;
    setStarting(true);
    let grant: string | null = null;
    try {
      // Pressing Send is the agreement, as it is for a map or game upload.
      grant = await beginReplaySend(gameId);
      const state = await startReplayUpload(
        hubUrl,
        replayPath,
        gameId,
        name,
        made.summary,
        grant,
      );
      rememberUpload(state, { kind: "replay", label, gameId });
      setOpen(false);
    } catch (e) {
      void notify({
        title: t`${label} was not sent`,
        body: describeError(e),
        level: "error",
      });
    } finally {
      setStarting(false);
      if (grant) {
        await endManualSend(grant).catch((e: unknown) => {
          console.warn("could not end replay send grant", e);
        });
      }
    }
  };

  let body: ReactNode;
  if (ending) {
    const said = describeUploadEnd(ending, label, { listed: null, game: null });
    body = (
      <>
        <p className="font-medium">{said.title}</p>
        {said.body && <p>{said.body}</p>}
        <div className="flex flex-wrap gap-2">
          {said.retry && (
            <Button
              size="sm"
              onClick={() => upload && setDismissed(upload.opId)}
            >
              {t`Send again`}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            {t`Close`}
          </Button>
        </div>
      </>
    );
  } else if (otherBuild && orders && orders.orders.length > 0) {
    body = (
      <p>
        {t`Another version of the game is installed, so Coilbox cannot say which unit each build order was for. Install the version it was played on, then try again.`}
      </p>
    );
  } else if (failed) {
    body = (
      <p>
        {stats.error ??
          t`Coilbox could not read the build orders in this replay.`}
      </p>
    );
  } else if (!made) {
    body = <p aria-busy>{t`Reading the replay…`}</p>;
  } else if ("problem" in made) {
    body = <p>{problemText(made.problem)}</p>;
  } else {
    body = (
      <>
        <p className="font-medium">{t`Send this replay to the hub?`}</p>
        <p>
          {t`It will be public. Anyone can download it and see the players, the build orders and the totals.`}
        </p>
        <p>{t`The hub notes that you sent it, as ${name}.`}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={starting} onClick={() => void send()}>
            {t`Send`}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            {t`Cancel`}
          </Button>
        </div>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          {icons(ending ? t`Not sent` : t`Send to hub`)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-sm">
        {body}
      </PopoverContent>
    </Popover>
  );
}
