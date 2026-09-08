/**
 * Pick a model, a script or a picture out of the game's archive (issue #2648).
 *
 * A path typed by hand is only found to be wrong when the game refuses to load
 * the unit, which is a long way from the field it was typed into. So the field
 * offers the archive instead: the files of the right kind under the folder the
 * engine reads that field from, with the one the field currently names already
 * selected.
 *
 * Nothing here reads an archive. The listing is the one the archive browser
 * uses, the model comes back through the unit viewer's own reader and the
 * picture through the member preview, so a file looks the same here as it does
 * on the archive page.
 *
 * A drawer rather than a dialog, alongside the builder's own model drawer, and
 * wide enough to hold the list and the preview side by side: choosing a model
 * by name alone is most of the problem this is meant to solve.
 */
import { Button, cn, Input } from "@picoframe/frame";
import { FileQuestion, Search, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  type AssetIndex,
  assetChoices,
  assetValue,
} from "@/content/assetKinds";
import type { ArchiveFileEntry } from "@/content/bindings";
import { useUnitsyncArchiveFile, useUnitsyncUnitModel } from "@/content/config";
import { ModelViewport } from "@/content/pages/components/ModelViewport";
import { formatBytes } from "@/lib/format";
import type { AssetField } from "../../assetFields";

/**
 * How many rows are drawn at once. Beyond All Reason holds 2,043 members under
 * `objects3d/` and 1,496 under `unitpics/`, counted from its archive listing on
 * 8 September 2026, so the search narrows rather than the list growing.
 */
const ROW_CAP = 200;

/** Extensions the preview draws as an image, so a file it could not draw can
 *  say which of the two reasons it was. */
const PICTURE = new Set([
  ".dds",
  ".png",
  ".pcx",
  ".bmp",
  ".tga",
  ".jpg",
  ".jpeg",
]);

const extensionOf = (path: string) => {
  const at = path.lastIndexOf(".");
  return at < 0 ? "" : path.slice(at).toLowerCase();
};

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

/** What the selected member looks like: the unit page's own model viewport for
 *  a model, the picture itself for a picture, and its source for a script. */
function Preview({
  member,
  field,
  archive,
  enginePath,
  dataDir,
}: {
  member: string | null;
  field: AssetField;
  archive: string;
  enginePath?: string;
  dataDir?: string;
}) {
  const isModel = field.kind.id === "model";
  const { model, loading: modelLoading } = useUnitsyncUnitModel(
    enginePath,
    dataDir,
    archive,
    isModel ? (member ?? undefined) : undefined,
  );
  const { data: file, loading: fileLoading } = useUnitsyncArchiveFile(
    enginePath,
    dataDir,
    archive,
    isModel ? undefined : (member ?? undefined),
  );

  if (!member)
    return (
      <Note>
        <FileQuestion className="size-5" />
        Pick a {field.kind.noun} to see it.
      </Note>
    );

  if (isModel) {
    if (modelLoading)
      return <Note>Reading this model out of the archive.</Note>;
    if (!model?.root)
      return <Note>Nothing drawable came out of this file.</Note>;
    return <ModelViewport model={model} className="h-full min-h-48" />;
  }

  if (fileLoading) return <Note>Reading this file.</Note>;
  if (!file) return <Note>Could not read this file.</Note>;
  if (file.kind === "image" && file.dataUrl)
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-3">
        <img
          src={file.dataUrl}
          alt={member}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  if (file.kind === "text" && file.text != null)
    return (
      <pre className="h-full overflow-auto p-3 font-mono text-[11px] leading-snug">
        {file.text}
      </pre>
    );
  return (
    <Note>
      {PICTURE.has(extensionOf(member))
        ? "This picture is in a format coilbox cannot draw. The game can still read it."
        : `No preview for this file (${formatBytes(file.size)}).`}
    </Note>
  );
}

/** The files on offer. A single click previews and a double click takes it, so
 *  looking at ten pictures does not mean opening the drawer ten times. */
function FileList({
  rows,
  root,
  selected,
  onSelect,
  onChoose,
}: {
  rows: ArchiveFileEntry[];
  root: string;
  selected: string | null;
  onSelect: (member: string) => void;
  onChoose: (member: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/50">
      {rows.map((entry) => (
        <button
          type="button"
          key={entry.path}
          onClick={() => onSelect(entry.path)}
          onDoubleClick={() => onChoose(entry.path)}
          className={cn(
            "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent/50",
            selected === entry.path && "bg-accent",
          )}
        >
          <span className="min-w-0 flex-1 truncate font-mono">
            {assetValue(root, entry.path)}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {formatBytes(entry.size)}
          </span>
        </button>
      ))}
    </div>
  );
}

export function AssetPicker({
  open,
  onOpenChange,
  field,
  label,
  current,
  index,
  archive,
  archiveLabel,
  enginePath,
  dataDir,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: AssetField;
  /** The field's own label, so the drawer says which field is being set. */
  label: string;
  /** The archive member the field currently names, so it opens on it. */
  current?: string;
  index: AssetIndex;
  /** The archive name unitsync knows the game by, which every read needs. */
  archive: string;
  /** The game's name, for saying which archive is being searched. */
  archiveLabel: string;
  enginePath?: string;
  dataDir?: string;
  onPick: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(current ?? null);

  const choices = useMemo(
    () => assetChoices(index, field.kind, field.root),
    [index, field],
  );
  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? choices.filter((entry) => entry.path.toLowerCase().includes(needle))
      : choices;
    return [...rows].sort((a, b) => a.path.localeCompare(b.path));
  }, [choices, query]);

  // The file the field already names is put at the top when the cap would
  // otherwise cut it. Beyond All Reason keeps 2,043 models, so for most units
  // the one they use sorts well past the two hundredth, and a picker that opens
  // on a file you cannot see has not said what the field is set to.
  const shown = useMemo(() => {
    const rows = matched.slice(0, ROW_CAP);
    if (!selected || rows.some((entry) => entry.path === selected)) return rows;
    const held = matched.find((entry) => entry.path === selected);
    return held ? [held, ...rows.slice(0, ROW_CAP - 1)] : rows;
  }, [matched, selected]);

  const take = (member: string) => {
    onPick(assetValue(field.root, member));
    onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[52rem] max-w-[95vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
            <div className="flex min-w-0 flex-1 flex-col">
              <DialogPrimitive.Title className="truncate text-base font-semibold">
                Choose a {field.kind.noun} for {label}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">
                {field.root === ""
                  ? archiveLabel
                  : `${archiveLabel}, under ${field.root}/`}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col gap-2 border-border/60 p-3 sm:border-r">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${field.kind.noun}s`}
                  aria-label={`Search ${field.kind.noun}s`}
                  className="h-8 pl-8"
                />
              </div>
              <FileList
                rows={shown}
                root={field.root}
                selected={selected}
                onSelect={setSelected}
                onChoose={take}
              />
              <p className="shrink-0 text-[11px] text-muted-foreground">
                {matched.length === 0
                  ? `No ${field.kind.noun}s here.`
                  : matched.length > ROW_CAP
                    ? `${ROW_CAP} of ${matched.length}. Search to narrow it.`
                    : `${matched.length} ${matched.length === 1 ? "file" : "files"}.`}
              </p>
            </div>

            <div className="flex min-h-0 flex-col">
              <div className="min-h-0 flex-1 overflow-hidden">
                <Preview
                  member={selected}
                  field={field}
                  archive={archive}
                  enginePath={enginePath}
                  dataDir={dataDir}
                />
              </div>
              <div className="flex shrink-0 items-center gap-3 border-t border-border/60 px-3 py-2">
                <span
                  className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                  title={selected ?? undefined}
                >
                  {selected
                    ? assetValue(field.root, selected)
                    : "Nothing picked"}
                </span>
                <Button
                  size="sm"
                  disabled={!selected}
                  onClick={() => selected && take(selected)}
                >
                  Use this {field.kind.noun}
                </Button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
