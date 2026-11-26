import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertCircle, CheckCircle2, ExternalLink, Upload } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes } from "@/lib/format";
import { errorText } from "@/lib/helpers";
import {
  type ArchiveUploadState,
  cancelArchiveUpload,
  listArchiveUploads,
  onArchiveUploadChanged,
  startArchiveUpload,
} from "../../../hub/archiveUploads";
import { beginEngineSend, endManualSend } from "../../../hub/manualSend/grant";
import {
  dlEngineUploadFacts,
  type EngineUploadFacts,
  type OfficialEngineBuild,
} from "../../bindings";
import { loadOfficialBuilds } from "../../engineLists";
import { HUB_ENGINE_NOTE_MAX, hasOfficialBuild } from "../../hubEngines";

type Step =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "ready"; path: string; facts: EngineUploadFacts }
  | { kind: "sending"; upload: ArchiveUploadState; grant: string | null }
  | { kind: "done"; upload: ArchiveUploadState };

/** The hub page an engine build gets once listed (`Engines::pagePath`). */
function enginePage(hubUrl: string, upload: ArchiveUploadState): string | null {
  const name = /^recoil_(.+)_([a-z0-9-]+)\.7z$/.exec(upload.filename);
  if (!name) return null;
  const [, version, platform] = name;
  return new URL(
    `/engines/${encodeURIComponent(version)}/${encodeURIComponent(platform)}`,
    hubUrl,
  ).toString();
}

/**
 * "Upload a test build", for people the hub lets upload engines. Reads the
 * picked `.7z` here, refuses a build an official Recoil release already has,
 * then sends it with the note through the same mirror upload maps and games
 * use. The upload belongs to the app, so leaving the page and coming back finds
 * it still going.
 */
export function EngineUpload({
  hubUrl,
  onListed,
}: {
  hubUrl: string;
  onListed: () => void;
}) {
  const { t } = useLingui();
  const noteId = useId();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // An engine upload started before this page opened is shown again.
  useEffect(() => {
    let live = true;
    listArchiveUploads()
      .then((uploads) => {
        const running = uploads.find(
          (u) => u.kind === "engine" && u.phase !== "done",
        );
        if (live && running) {
          setStep({ kind: "sending", upload: running, grant: null });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const sendingSha = step.kind === "sending" ? step.upload.sha256 : null;
  const grant = step.kind === "sending" ? step.grant : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows one upload, named by its hash
  useEffect(() => {
    if (!sendingSha) return;
    let finished = false;
    const follow = (upload: ArchiveUploadState) => {
      if (upload.sha256 !== sendingSha || finished) return;
      if (upload.phase !== "done") {
        setStep((s) => (s.kind === "sending" ? { ...s, upload } : s));
        return;
      }
      finished = true;
      if (grant) void endManualSend(grant);
      setStep({ kind: "done", upload });
      if (upload.outcome?.kind === "listed") onListed();
    };
    const unlisten = onArchiveUploadChanged(follow);
    // A change announced before the listener was in place is read back here.
    listArchiveUploads()
      .then((uploads) => {
        const now = uploads.find((u) => u.sha256 === sendingSha);
        if (now) follow(now);
      })
      .catch(() => {});
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [sendingSha]);

  const pick = async () => {
    setError(null);
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: t`Engine build`, extensions: ["7z"] }],
    }).catch(() => null);
    if (typeof path !== "string") return;
    setStep({ kind: "reading" });
    try {
      const { facts } = await dlEngineUploadFacts({ path });
      let official: OfficialEngineBuild[];
      try {
        official = (await loadOfficialBuilds()).builds;
      } catch (e) {
        const why = errorText(e);
        setError(
          t`Coilbox could not check the official Recoil releases, so it cannot tell whether the hub needs this build. ${why}`,
        );
        setStep({ kind: "idle" });
        return;
      }
      if (hasOfficialBuild(official, facts.version, facts.platform)) {
        const { version, platform } = facts;
        setError(
          t`An official Recoil release already has a ${platform} build of ${version}, so the hub does not take this one.`,
        );
        setStep({ kind: "idle" });
        return;
      }
      setNote("");
      setStep({ kind: "ready", path, facts });
    } catch (e) {
      setError(errorText(e));
      setStep({ kind: "idle" });
    }
  };

  const send = async (path: string, facts: EngineUploadFacts) => {
    setError(null);
    let opened: string | null = null;
    try {
      opened = await beginEngineSend(facts.filename);
      const upload = await startArchiveUpload(
        hubUrl,
        path,
        {
          ...facts,
          shortname: null,
          author: null,
          description: null,
          note: note.trim(),
        },
        opened,
      );
      setStep({ kind: "sending", upload, grant: opened });
    } catch (e) {
      if (opened) void endManualSend(opened);
      setError(errorText(e));
    }
  };

  const trimmed = note.trim().length;

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertCircle size={15} />
          <AlertDescription className="text-destructive">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {(step.kind === "idle" || step.kind === "reading") && (
        <Button
          variant="outline"
          size="sm"
          onClick={pick}
          disabled={step.kind === "reading"}
        >
          <Upload />
          {step.kind === "reading"
            ? t`Reading the build…`
            : t`Upload a test build`}
        </Button>
      )}

      {step.kind === "ready" && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <div>
            <p className="font-mono text-sm">{step.facts.filename}</p>
            <p className="text-xs text-muted-foreground">
              {step.facts.version} · {step.facts.platform} ·{" "}
              {formatBytes(step.facts.size)}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={noteId}>
              <Trans>Note</Trans>
            </Label>
            <Textarea
              id={noteId}
              value={note}
              maxLength={HUB_ENGINE_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">
              {note.length} / {HUB_ENGINE_NOTE_MAX}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => send(step.path, step.facts)}
              disabled={trimmed === 0}
            >
              <Upload />
              <Trans>Upload</Trans>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStep({ kind: "idle" })}
            >
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </div>
      )}

      {step.kind === "sending" && (
        <div className="space-y-2 rounded-md border border-border p-4">
          <p className="font-mono text-sm">{step.upload.filename}</p>
          <Progress
            value={
              step.upload.size > 0
                ? (step.upload.sent / step.upload.size) * 100
                : 0
            }
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {step.upload.phase === "waiting"
                ? t`Waiting for the hub to list it…`
                : `${formatBytes(step.upload.sent)} / ${formatBytes(step.upload.size)}`}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => cancelArchiveUpload(step.upload.opId)}
            >
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </div>
      )}

      {step.kind === "done" && (
        <UploadEnded
          hubUrl={hubUrl}
          upload={step.upload}
          onAgain={() => setStep({ kind: "idle" })}
        />
      )}
    </div>
  );
}

function UploadEnded({
  hubUrl,
  upload,
  onAgain,
}: {
  hubUrl: string;
  upload: ArchiveUploadState;
  onAgain: () => void;
}) {
  const { t } = useLingui();
  const outcome = upload.outcome;
  const filename = upload.filename;
  const page =
    outcome?.kind === "listed"
      ? enginePage(hubUrl, upload)
      : outcome?.kind === "stopped"
        ? (outcome.duplicate?.url ?? null)
        : null;
  const said =
    outcome?.kind === "listed"
      ? t`${filename} is listed on the hub.`
      : outcome?.kind === "cancelled"
        ? t`The upload of ${filename} was cancelled.`
        : (outcome?.said ?? t`The upload of ${filename} stopped.`);

  return (
    <div className="space-y-2">
      <Alert variant={outcome?.kind === "stopped" ? "destructive" : "default"}>
        {outcome?.kind === "listed" ? (
          <CheckCircle2 size={15} />
        ) : (
          <AlertCircle size={15} />
        )}
        <AlertDescription
          className={
            outcome?.kind === "stopped" ? "text-destructive" : undefined
          }
        >
          {said}
        </AlertDescription>
      </Alert>
      <div className="flex gap-2">
        {page && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openUrl(page).catch(() => {})}
          >
            <ExternalLink />
            {outcome?.kind === "listed"
              ? t`Open its hub page`
              : t`Open the build the hub has`}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onAgain}>
          <Upload />
          <Trans>Upload another</Trans>
        </Button>
      </div>
    </div>
  );
}
