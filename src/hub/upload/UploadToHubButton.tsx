import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUp } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CoilboxGlyph } from "@/components/CoilboxGlyph";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { isSddName, isSdpName } from "@/content/format";
import { describeError } from "@/i18n/uiError";
import { formatBytes } from "@/lib/format";
import { notify } from "@/notify/notify";
import { useHubAccount } from "../account";
import { type ArchiveFacts, startArchiveUpload } from "../archiveUploads";
import { useHubUrl } from "../config";
import {
  beginManualSend,
  endManualSend,
  type SendSubject,
} from "../manualSend/grant";
import { startManualSend } from "../manualSend/run";
import { gamePageUrl, type HubState } from "../manualSend/status";
import { SignInButton } from "../pages/components/AccountControl";
import { describeUploadEnd } from "./messages";
import {
  rememberUpload,
  type UploadSubject,
  uploadOf,
  useArchiveUploads,
} from "./store";
import { type FactsRequest, useUploadFacts } from "./useUploadFacts";

/** The map or game an upload button is on. */
export type UploadTarget =
  | { kind: "map"; mapName: string }
  | { kind: "game"; archiveName: string };

/** Whether this game is installed as something the hub has no place for: a
 *  rapid package or an unpacked folder. The hub takes one `.sd7` or `.sdz`. */
export function packedInstall(
  archiveName: string,
  archivePath?: string,
): "rapid" | "folder" | null {
  const names = [archiveName, archivePath];
  if (names.some((name) => isSdpName(name))) return "rapid";
  if (names.some((name) => isSddName(name))) return "folder";
  return null;
}

/**
 * "Upload to hub", beside the send control on a map or game's page (issue #5259).
 *
 * Offered for every installed map and game, and gone once the hub lists an
 * archive with this one's hash. A game installed through rapid or as an unpacked
 * folder keeps the button, and the panel it opens says plainly that the hub
 * takes one `.sd7` or `.sdz` file. A disabled button cannot say why, and nothing
 * a player does on the page changes the answer.
 *
 * The button opens a panel and nothing leaves the machine until its Upload
 * button is pressed. The panel is where somebody signs in, reads what will be
 * public, and finds out how the last upload of this file ended. The transfer
 * itself belongs to the app: the topbar shows it, and leaving the page does not
 * stop it.
 */
export function UploadToHubButton({
  target,
  label,
  shortname,
  enginePath,
  dataDir,
  archivePath,
  fileName,
  hub,
  pageUrl,
  sendSubject,
}: {
  target: UploadTarget;
  /** What a person calls it. */
  label: string;
  /** A game's modinfo shortname, for the hub page of the game. */
  shortname?: string | null;
  enginePath?: string;
  dataDir?: string;
  /** Where the archive file is. Without it there is nothing to send. */
  archivePath?: string;
  /** The archive's file name, which finds an upload of it before its facts are read. */
  fileName?: string;
  hub: HubState;
  /** The item's page on the hub, when it has one. */
  pageUrl: string | null;
  /** What the page's send control sends, when it has one. A game the hub does
   *  not know is offered that send before the file goes up. */
  sendSubject?: SendSubject;
}) {
  const { t } = useLingui();
  const hubUrl = useHubUrl();
  const account = useHubAccount(hubUrl);
  const uploads = useArchiveUploads();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [again, setAgain] = useState(0);

  const packed =
    target.kind === "game"
      ? packedInstall(target.archiveName, archivePath)
      : null;
  const hubHas = hub.hashes && hub.hashes.size > 0;
  const request: FactsRequest | null =
    !packed && enginePath && dataDir && (open || hubHas)
      ? {
          enginePath,
          dataDir,
          ...(target.kind === "map"
            ? { map: target.mapName }
            : { game: target.archiveName }),
        }
      : null;
  const read = useUploadFacts(request, again);
  const { facts } = read;

  const upload = uploadOf(
    uploads,
    hubUrl,
    target.kind,
    facts?.filename ?? fileName,
  );
  const running = upload !== undefined && upload.phase !== "done";
  const ending =
    upload?.phase === "done" && upload.outcome && upload.opId !== dismissed
      ? upload.outcome
      : null;

  const listed = facts !== undefined && hub.hashes?.has(facts.sha256) === true;
  if (listed) return null;
  // The hub has not said what it holds, so an upload could be one it already
  // has, or one it cannot take at all. The send control waits the same way.
  if (!running && !ending && hub.hashes === undefined) return null;
  if (!running && !packed && (!enginePath || !dataDir || !archivePath)) {
    return null;
  }

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
        {icons(t`Uploading…`)}
      </Button>
    );
  }

  const subject: UploadSubject =
    target.kind === "map"
      ? { kind: "map", label, mapName: target.mapName }
      : { kind: "game", label, shortname: shortname ?? undefined };

  const go = async (checked: ArchiveFacts) => {
    if (!archivePath) return;
    setStarting(true);
    let grant: string | null = null;
    try {
      // Pressing Upload on the panel is the agreement, as it is for a send.
      grant = await beginManualSend(
        target.kind === "map"
          ? { kind: "map", map_name: checked.internal_name }
          : { kind: "game", shortname: checked.shortname ?? "" },
      );
      const state = await startArchiveUpload(
        hubUrl,
        archivePath,
        checked,
        grant,
      );
      rememberUpload(state, subject);
      setOpen(false);
    } catch (e) {
      void notify({
        title: t`${label} was not uploaded`,
        body: describeError(e),
        level: "error",
      });
    } finally {
      setStarting(false);
      if (grant) {
        await endManualSend(grant).catch((e: unknown) => {
          console.warn("could not end hub upload grant", e);
        });
      }
    }
  };

  const retry = () => {
    if (upload) setDismissed(upload.opId);
    setAgain((n) => n + 1);
  };

  const links = {
    listed: pageUrl,
    game:
      target.kind === "game" && shortname
        ? gamePageUrl(hubUrl, shortname)
        : null,
  };

  let body: ReactNode;
  if (packed) {
    body = (
      <p>
        {packed === "rapid"
          ? t`${label} is installed through rapid. The hub takes one .sd7 or .sdz file, so it cannot be uploaded.`
          : t`${label} is installed as an unpacked folder. The hub takes one .sd7 or .sdz file, so it cannot be uploaded.`}
      </p>
    );
  } else if (ending) {
    const said = describeUploadEnd(ending, label, links);
    const { link } = said;
    body = (
      <>
        <p className="font-medium">{said.title}</p>
        {said.body && <p>{said.body}</p>}
        <div className="flex flex-wrap gap-2">
          {link && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openUrl(link.url).catch(() => {})}
            >
              {link.label}
            </Button>
          )}
          {said.sendFirst && sendSubject && enginePath && dataDir && (
            <Button
              size="sm"
              onClick={() => {
                if (upload) setDismissed(upload.opId);
                setOpen(false);
                void startManualSend({
                  hubUrl,
                  enginePath,
                  dataDir,
                  subject: sendSubject,
                  label,
                });
              }}
            >
              {t`Send to hub`}
            </Button>
          )}
          {said.retry ? (
            <Button size="sm" onClick={retry}>
              {t`Upload again`}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (upload) setDismissed(upload.opId);
              }}
            >
              {t`Close`}
            </Button>
          )}
        </div>
      </>
    );
  } else if (!account.signedIn) {
    body = (
      <>
        <p>{t`Sign in to the hub to upload ${label}.`}</p>
        <SignInButton
          hubUrl={hubUrl}
          busy={account.busy}
          onSignIn={account.signIn}
        />
      </>
    );
  } else if (read.loading || (!facts && !read.problem && !read.failed)) {
    body = <p aria-busy>{t`Reading ${label}…`}</p>;
  } else if (!facts) {
    body = <p>{read.problem ?? read.failed}</p>;
  } else {
    const size = formatBytes(facts.size);
    const file = facts.filename;
    body = (
      <>
        <p className="font-medium">{t`Upload ${label} to the hub?`}</p>
        <p>
          {t`${file} (${size}) will be public. Anyone can download it from the hub's mirrors.`}
        </p>
        <p>{t`The hub keeps the name of your account, privately.`}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={starting} onClick={() => void go(facts)}>
            {t`Upload`}
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
          {icons(t`Upload to hub`)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 text-sm">
        {body}
      </PopoverContent>
    </Popover>
  );
}
