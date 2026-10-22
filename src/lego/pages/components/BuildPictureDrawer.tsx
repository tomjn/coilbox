/**
 * Take the build picture of a unit: the small picture a game's build menu shows
 * for it (issue #3347).
 *
 * The preview is the frame the picture will have, taken from the live viewport
 * with the same settings. Taking it stores the PNG and what it was taken with on
 * the project. Export writes it to `unitpics/<unit>.png` from there, so a later
 * export never takes a new picture on its own: the drawer says when the unit
 * has changed and leaves the choice to the game maker.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { describeError } from "@/i18n/uiError";
import { formatDateTime } from "@/lib/format";
import { legoPictureSurvey, type PictureSurvey } from "../../bindings";
import {
  clampPictureSize,
  DEFAULT_PICTURE_SIZE,
  PICTURE_VIEWS,
  pictureFingerprint,
  pictureIsStale,
  pictureNotices,
  viewDirection,
} from "../../buildPicture";
import type { BuildPicture, LegoProject, PictureViewId } from "../../model";
import { savePicture } from "../../projects";
import type { Capture, PictureShot } from "../../thumbnail";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: LegoProject;
  capture: Capture;
  /** Remembers how the picture was taken on the project. */
  onTaken: (picture: BuildPicture) => void;
}

/** The colour the picker starts on when a picture is given a background. */
const DEFAULT_BACKGROUND = "#808080";

/** How long to wait for textures that have not arrived before asking again. */
const PREVIEW_RETRY_MS = 250;

export function BuildPictureDrawer({
  open: isOpen,
  onOpenChange,
  project,
  capture,
  onTaken,
}: Props) {
  const { t } = useLingui();
  const taken = project.picture;
  const [size, setSize] = useState(taken?.size ?? DEFAULT_PICTURE_SIZE);
  const [view, setView] = useState<PictureViewId>(taken?.view ?? "right");
  const [transparent, setTransparent] = useState(
    taken ? taken.background === null : true,
  );
  const [colour, setColour] = useState(taken?.background ?? DEFAULT_BACKGROUND);
  const [preview, setPreview] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [survey, setSurvey] = useState<PictureSurvey | null>(null);

  const background = transparent ? null : colour;
  const shot: PictureShot = {
    pixels: size,
    background,
    view: viewDirection(view),
  };
  const fingerprint = pictureFingerprint(project);

  // The preview is the frame the picture will have, so it is taken with the
  // settings above whenever they or the unit change. A unit whose textures have
  // not arrived answers null, so it asks again until it gets a frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shot` is built from the dependencies listed, and `fingerprint` stands for the unit
  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const draw = () => {
      const canvas = capture(shot);
      if (!live) return;
      if (canvas) {
        setPreview(canvas.toDataURL("image/png"));
      } else {
        setPreview(null);
        timer = setTimeout(draw, PREVIEW_RETRY_MS);
      }
    };
    timer = setTimeout(draw, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [isOpen, capture, size, view, background, fingerprint]);

  // What the game already holds, so a size or format that does not match its
  // own pictures is said before the picture is taken rather than after.
  const dir = project.exportDir;
  useEffect(() => {
    if (!isOpen || !dir) {
      setSurvey(null);
      return;
    }
    let live = true;
    legoPictureSurvey({ dir })
      .then((found) => {
        if (live) setSurvey(found);
      })
      .catch(() => {
        if (live) setSurvey(null);
      });
    return () => {
      live = false;
    };
  }, [isOpen, dir]);

  async function take() {
    setWorking(true);
    setProblem(null);
    try {
      const canvas = capture(shot);
      if (!canvas) {
        setProblem(t`The unit is not ready to photograph yet.`);
        return;
      }
      await savePicture(project.id, canvas);
      onTaken({
        size: canvas.width,
        background,
        view,
        takenAt: new Date().toISOString(),
        fingerprint,
      });
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setWorking(false);
    }
  }

  const notices = survey ? pictureNotices(survey, size) : [];
  const stale = pictureIsStale(project);
  const projectName = project.name;
  const takenWhen = taken?.takenAt
    ? formatDateTime(new Date(taken.takenAt))
    : "";
  const takenSize = taken?.size ?? 0;

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              <Trans>Build picture</Trans>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t`Close`}>
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-col gap-5 overflow-y-auto px-5 pt-4 pb-8">
            <div
              className="flex aspect-square w-full items-center justify-center overflow-hidden rounded border border-border"
              style={{
                backgroundImage:
                  "conic-gradient(#0000000d 25%, transparent 0 50%, #0000000d 0 75%, transparent 0)",
                backgroundSize: "16px 16px",
              }}
            >
              {preview ? (
                <img
                  src={preview}
                  alt={t`${projectName} as it will look on a build menu`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  <Trans>Nothing to photograph yet</Trans>
                </span>
              )}
            </div>

            <Field label={t`Camera angle`}>
              <OptionSelect
                value={view}
                onValueChange={(value) => setView(value as PictureViewId)}
                options={PICTURE_VIEWS.map((v) => ({
                  value: v.id,
                  label: v.label,
                }))}
                ariaLabel={t`Camera angle`}
              />
            </Field>

            <Field label={t`Size in pixels`}>
              <Input
                type="number"
                min={1}
                value={size}
                onChange={(e) =>
                  setSize(clampPictureSize(e.target.valueAsNumber))
                }
              />
            </Field>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="lego-picture-transparent"
                  checked={transparent}
                  onCheckedChange={(checked) =>
                    setTransparent(checked === true)
                  }
                />
                <Label htmlFor="lego-picture-transparent">
                  <Trans>Transparent background</Trans>
                </Label>
              </div>
              {transparent ? null : (
                <input
                  type="color"
                  aria-label={t`Background colour`}
                  className="h-8 w-16 rounded border border-input"
                  value={colour}
                  onChange={(e) => setColour(e.target.value)}
                />
              )}
            </div>

            {notices.map((notice) => (
              <p key={notice} className="text-xs text-muted-foreground">
                {notice}
              </p>
            ))}

            <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
              <Button onClick={() => void take()} disabled={working}>
                {working
                  ? t`Taking`
                  : taken
                    ? t`Update picture`
                    : t`Take picture`}
              </Button>
              {taken ? (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Taken {takenWhen}, {takenSize} by {takenSize} pixels.
                  </Trans>
                  {stale ? (
                    <>
                      {" "}
                      <Trans>The unit has changed since.</Trans>
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  <Trans>No picture taken yet.</Trans>
                </p>
              )}
              {problem ? (
                <p className="text-xs text-destructive">{problem}</p>
              ) : null}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
