import { Button, Input } from "@picoframe/frame";
import { join, tempDir } from "@tauri-apps/api/path";
import { FolderSearch } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { unitsyncArchiveExtract } from "@/content/bindings";
import {
  useUnitsyncArchiveFile,
  useUnitsyncArchiveTree,
  useUnitsyncScan,
} from "@/content/config";
import { formatBytes } from "@/lib/format";
import { usePreferredTarget } from "@/play/config";
import {
  type CampaignImageKind,
  campaignImageImportData,
  campaignMediaImport,
  campaignMediaImportData,
} from "../../bindings";
import {
  type ArchiveMediaType,
  archiveFileExt,
  archiveMediaKey,
  filterArchiveFilesByType,
  needsDuplicateConfirm,
  searchArchiveFiles,
} from "./archiveMedia";

/** Rendered results are capped so a huge game archive (thousands of textures)
 * never has to mount thousands of rows at once. Narrowing the search shrinks
 * the list instead. */
const RESULT_LIMIT = 200;

/**
 * "Import from game files" for a campaign media picker: browses the target
 * game's own archive via the same unitsync VFS commands the content browser
 * uses ({@link useUnitsyncArchiveTree}/{@link useUnitsyncArchiveFile}), lets the
 * author preview an image or play an audio clip, then imports the selected
 * member straight into the campaign's media store through the *same* commands
 * a file-picker import uses ({@link campaignImageImportData} /
 * {@link campaignMediaImportData}), so the resulting `{ kind: "file" }` ref is
 * indistinguishable from one picked off disk.
 *
 * A video pick has no in-popover preview: unitsync's archive preview command
 * only decodes image/audio/text members, so a video always reports as binary.
 * Instead it is extracted to a temp file with {@link unitsyncArchiveExtract}
 * and that path is handed to {@link campaignMediaImport}, avoiding buffering a
 * potentially large clip through this process as base64. The field the button
 * sits in resolves the resulting `{ kind: "file" }` ref itself, so the video
 * still plays there once the import completes.
 *
 * Renders as a popover (not the app's single shared drawer) so it can be opened
 * from *inside* an already-open drawer, e.g. the mission editor, without
 * replacing that drawer's content.
 *
 * `gameName` is the mission's (or, for campaign-level fields, the best-effort
 * first mission's) game. Every unavailable state, no game set, the game not
 * installed under the current play target, or its archive failing to read,
 * is explained inline rather than hidden. The field's own file-picker button
 * stays available as a sibling control throughout.
 */
export function ArchiveMediaImportButton({
  campaignId,
  gameName,
  mediaType,
  imageKind,
  triggerLabel = "From game files",
  onImported,
}: {
  campaignId: string;
  gameName: string | undefined;
  mediaType: ArchiveMediaType;
  /** Passed through to {@link campaignImageImportData} for image imports. */
  imageKind?: CampaignImageKind;
  /**
   * Overrides the trigger button's text. A field that shows two of these
   * side by side (an image-or-video slot) needs distinct labels. A
   * single-purpose field can leave this at its default.
   */
  triggerLabel?: string;
  onImported: (file: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Archive members already imported this popover's lifetime, so re-picking the
  // same one warns instead of quietly minting a second copy in the store.
  const importedRef = useRef<Set<string>>(new Set());

  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const game = gameName
    ? (scan.data?.games.find((g) => g.name === gameName) ?? null)
    : null;
  // Only fetched while the popover is open, and only once a game resolves, so
  // closed fields never pay for an archive scan they'll never show.
  const archiveName = open && game ? game.primaryArchive.name : undefined;
  const { tree, loading: treeLoading } = useUnitsyncArchiveTree(
    target?.enginePath,
    target?.dataDir,
    archiveName,
  );
  // A video member always previews as binary (unitsync doesn't decode video),
  // so skip fetching it entirely rather than spend a worker session on a
  // preview that's never shown.
  const { data: preview, loading: previewLoading } = useUnitsyncArchiveFile(
    target?.enginePath,
    target?.dataDir,
    archiveName,
    mediaType === "video" ? undefined : (selected ?? undefined),
  );

  const filtered = useMemo(() => {
    if (!tree) return [];
    return searchArchiveFiles(
      filterArchiveFilesByType(tree.files, mediaType),
      query,
    );
  }, [tree, mediaType, query]);
  const visible = filtered.slice(0, RESULT_LIMIT);
  const selectedEntry = visible.find((f) => f.path === selected);

  const reset = () => {
    setQuery("");
    setSelected(null);
    setConfirmKey(null);
    setError(null);
  };

  const pick = (path: string) => {
    setSelected(path);
    setConfirmKey(null);
    setError(null);
  };

  const dup =
    archiveName && selected
      ? needsDuplicateConfirm(
          importedRef.current,
          archiveName,
          selected,
          confirmKey,
        )
      : false;

  const doImport = async () => {
    if (!selected || !archiveName) return;
    if (mediaType !== "video" && !preview) return;
    if (mediaType === "video" && (!target?.enginePath || !target?.dataDir)) {
      return;
    }
    if (
      needsDuplicateConfirm(
        importedRef.current,
        archiveName,
        selected,
        confirmKey,
      )
    ) {
      setConfirmKey(archiveMediaKey(archiveName, selected));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let file: string;
      if (mediaType === "video") {
        // No data-URL round trip for video: extract the member to a temp file
        // on disk, then hand that path to the same file-based import a
        // file-picker video uses. The temp file is left for the OS to reclaim
        // rather than deleted here, there's no delete-file command exposed to
        // the frontend and adding one purely for this cleanup isn't worth the
        // extra attack surface.
        const ext = archiveFileExt(selected) || "bin";
        const dest = await join(
          await tempDir(),
          `coilbox-video-import-${crypto.randomUUID()}.${ext}`,
        );
        const extracted = await unitsyncArchiveExtract({
          enginePath: target?.enginePath ?? "",
          dataDir: target?.dataDir ?? "",
          archive: archiveName,
          file: selected,
          dest,
        });
        if (extracted.errors.length > 0) {
          throw new Error(extracted.errors.join(". "));
        }
        ({ file } = await campaignMediaImport({ campaignId, srcPath: dest }));
      } else if (mediaType === "image") {
        if (preview?.kind !== "image" || !preview.dataUrl) {
          throw new Error(
            preview?.truncated
              ? "This image is too large to import from the archive. Use the file picker instead."
              : "Couldn't read this file as an image.",
          );
        }
        ({ file } = await campaignImageImportData({
          campaignId,
          dataUri: preview.dataUrl,
          kind: imageKind,
        }));
      } else {
        if (preview?.kind !== "audio" || !preview.dataUrl) {
          throw new Error(
            preview?.truncated
              ? "This clip is too large to import from the archive. Use the file picker instead."
              : "Couldn't read this file as audio.",
          );
        }
        ({ file } = await campaignMediaImportData({
          campaignId,
          dataUri: preview.dataUrl,
          ext: archiveFileExt(selected) || "bin",
        }));
      }
      importedRef.current.add(archiveMediaKey(archiveName, selected));
      onImported(file);
      setOpen(false);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const noun =
    mediaType === "audio"
      ? "audio clip"
      : mediaType === "video"
        ? "video"
        : "image";
  const resolving = scan.loading || (Boolean(archiveName) && treeLoading);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <FolderSearch className="size-4" /> {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-96 flex-col gap-3 p-3">
        {!gameName ? (
          <p className="text-xs text-muted-foreground">
            This mission has no game set yet, so there is no archive to browse.
            Use the file picker instead.
          </p>
        ) : resolving ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !game ? (
          <p className="text-xs text-muted-foreground">
            &quot;{gameName}&quot; isn&apos;t installed under the current play
            target, so its files can&apos;t be browsed. Use the file picker
            instead.
          </p>
        ) : !tree ? (
          <p className="text-xs text-muted-foreground">
            Could not read this game&apos;s archive. Use the file picker
            instead.
          </p>
        ) : (
          <>
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
              placeholder={`Search ${noun} files…`}
              className="h-8"
            />
            <ul className="flex max-h-40 flex-col overflow-auto rounded-md border border-border/50">
              {visible.length === 0 ? (
                <li className="p-2 text-xs text-muted-foreground">
                  No {noun} files matched in this game&apos;s archive.
                </li>
              ) : (
                visible.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => pick(f.path)}
                      className={`block w-full truncate px-2 py-1 text-left font-mono text-xs hover:bg-accent/50 ${
                        selected === f.path ? "bg-accent" : ""
                      }`}
                      title={f.path}
                    >
                      {f.path}
                    </button>
                  </li>
                ))
              )}
            </ul>
            {filtered.length > RESULT_LIMIT && (
              <p className="text-xs text-muted-foreground">
                Showing the first {RESULT_LIMIT} of {filtered.length} matches.
                Narrow your search to see the rest.
              </p>
            )}

            {selected && (
              <div className="flex flex-col gap-2 rounded-md border border-border/50 bg-muted/20 p-2">
                {mediaType === "video" ? (
                  <p className="text-xs text-muted-foreground">
                    {selectedEntry?.size != null
                      ? formatBytes(selectedEntry.size)
                      : "Unknown size"}
                    . No preview before import here. It plays in the field below
                    once imported.
                  </p>
                ) : previewLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : preview?.kind === "image" && preview.dataUrl ? (
                  <img
                    src={preview.dataUrl}
                    alt={selected}
                    className="mx-auto max-h-32 object-contain"
                  />
                ) : preview?.kind === "audio" && preview.dataUrl ? (
                  // biome-ignore lint/a11y/useMediaCaption: archive audio has no caption track
                  <audio controls src={preview.dataUrl} className="w-full" />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {preview?.truncated
                      ? "Too large to preview."
                      : "No preview available for this file."}
                  </p>
                )}
                {dup && (
                  <Alert className="p-2">
                    <AlertDescription className="text-xs">
                      Already imported from this archive earlier this session.
                      Import again to add a second copy.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {error && (
              <Alert variant="destructive" className="p-2">
                <AlertDescription className="text-xs text-destructive">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            <Button
              size="sm"
              onClick={doImport}
              disabled={!selected || busy || previewLoading}
            >
              {busy ? "Importing…" : dup ? "Import again" : "Import"}
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
