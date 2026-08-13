/**
 * One layout, on a page of its own (issue #1415).
 *
 * A full page rather than a drawer, because editing a base is the work rather
 * than a detour from it: the surface wants the room, and the address is worth
 * having so a layout can be linked to.
 *
 * Everything that draws and edits is `BlueprintEditor`, which is the scenario
 * editor's placement surface with the mission taken off it. This page is the
 * library's half: which layout is open, what it is called, and getting each edit
 * onto disk.
 *
 * Edits save themselves. A layout is edited by dragging buildings around, and
 * there is no moment in that which reads as "now I am done", so a Save button
 * would only be a way to lose a base by leaving the page. What is on screen is
 * written a moment after the last change, and again on the way out.
 */

import { Button, useDrawer } from "@picoframe/frame";
import { ArrowLeft, Copy, Loader2, Repeat, Share2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "@/content/pages/components/states";
import { useGameUnits } from "@/content/useGameUnits";
import { nextDrawerKey } from "@/general/drawerKey";
import { hubItemRoute, isHubItemPageReachable } from "@/hub/config";
import { BlueprintEditor } from "@/placement/BlueprintEditor";
import {
  duplicatedBlueprint,
  footprintsFromUnits,
  libraryLayout,
  recordGameName,
  recordWithLayout,
  type StoredBlueprint,
  sourceSummary,
} from "../library";
import type { BaseBlueprint } from "../model";
import {
  blueprintRoute,
  deleteBlueprint,
  saveBlueprint,
  useBlueprintLibrary,
} from "../store";

/** How long after the last change the layout is written. Long enough that a
 *  drag is one write rather than several, short enough that nobody has to think
 *  about it. */
const SAVE_AFTER_MS = 800;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function BlueprintDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { records, loading, error } = useBlueprintLibrary();

  const stored = records.find((record) => record.id === id) ?? null;
  // What is on screen, which is ahead of what is on disk between an edit and
  // the write that follows it. Falls back to the stored record, so opening a
  // page shows the library's copy and every edit after that shows this one.
  const [draft, setDraft] = useState<StoredBlueprint | null>(null);
  const record = draft?.id === id ? draft : stored;

  const gameName = record ? recordGameName(record) : "";
  const { units } = useGameUnits(gameName);
  const footprints = useMemo(() => footprintsFromUnits(units), [units]);

  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef<StoredBlueprint | null>(null);

  const flush = useCallback(async () => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setSaving(true);
    try {
      await saveBlueprint(next);
      setSaveError(null);
    } catch (e) {
      // Kept in hand as well as on screen: the layout is still the draft, so
      // the next edit tries again with everything in it.
      pending.current = next;
      setSaveError(message(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const edit = (next: StoredBlueprint) => {
    setDraft(next);
    pending.current = next;
    setRevision((at) => at + 1);
  };

  // A fresh timer per edit, so a drag that moves ten times is one write.
  useEffect(() => {
    if (revision === 0) return;
    const timer = setTimeout(() => void flush(), SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [revision, flush]);

  // Leaving the page cannot be what loses the last edit, so whatever the timer
  // has not written yet is written now.
  useEffect(() => () => void flush(), [flush]);

  if (loading && !record) return <SkeletonList />;

  if (!record) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <BackLink />
        {error ? (
          <ErrorBanner message={error} />
        ) : (
          <EmptyState label="That layout isn't in your library. It may have been deleted." />
        )}
      </div>
    );
  }

  const buildings = record.layout.buildings.length;

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          {/* Named rather than renamed here: the one name field is the
              editor's, so a rename is a step the history holds like any other
              edit (issue #1454). */}
          <h1 className="truncate text-lg font-semibold">
            {record.layout.name}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {gameName || "No game named"} · {buildings} building
            {buildings === 1 ? "" : "s"}
            {record.layout.ordered ? " · build order" : ""}
          </p>
          {/* Where this copy came from, for a layout that did not start here
              (issue #1313). The whole path, because the point of recording it
              is being able to go back to the file. */}
          {record.source && (
            <p className="break-all text-xs text-muted-foreground">
              {sourceSummary(record.source)}
              {record.source.at
                ? ` Taken on ${new Date(record.source.at).toLocaleDateString()}.`
                : ""}
              {/* The recorded item id is the key back into the hub, so it is
                  worth a door rather than a number nothing opens (issue
                  #1487). The app's own item page rather than the website: it
                  says the same things, it is where a hub link already lands,
                  and it answers a withdrawn item with the hub's own "no such
                  item, it may have been taken down" instead of a browser tab
                  showing a 404. Hidden when a profile has switched the hub off
                  or hidden it, because that route then redirects home. */}
              {record.source.kind === "hub" && isHubItemPageReachable() && (
                <>
                  {" "}
                  <Link
                    to={hubItemRoute(record.source.item)}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    See it on the hub
                  </Link>
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <SaveState saving={saving} error={saveError} />
          <SubstituteButton
            record={record}
            onApply={(layout) =>
              edit(recordWithLayout(record, layout, footprints))
            }
          />
          <DuplicateBlueprintButton
            record={record}
            taken={records.map((entry) => entry.layout.name)}
          />
          <ShareBlueprintButton record={record} />
          <DeleteBlueprintButton
            name={record.layout.name}
            onDelete={async () => {
              // Nothing left to write, and a write after the delete would put
              // the layout straight back.
              pending.current = null;
              await deleteBlueprint(record.id);
              navigate("/content/blueprints");
            }}
          />
        </div>
      </header>

      {saveError && <ErrorBanner message={`Not saved: ${saveError}`} />}

      <BlueprintEditor
        blueprint={libraryLayout(record)}
        gameName={gameName}
        onChange={(layout) =>
          edit(recordWithLayout(record, layout, footprints))
        }
      />

      <p className="text-xs text-muted-foreground">
        A blueprint is a shape rather than a place, so there is no map here and
        no team. Put it down in a mission from the scenario builder, or send it
        to a game's own blueprint file from there.
      </p>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/content/blueprints"
      className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:underline"
    >
      <ArrowLeft className="size-3.5" /> Blueprints
    </Link>
  );
}

/** Whether what is on screen is on disk. Quiet when it is, because a library
 *  that says "Saved" forever is noise. */
function SaveState({
  saving,
  error,
}: {
  saving: boolean;
  error: string | null;
}) {
  if (error) return null;
  if (!saving) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" /> Saving
    </span>
  );
}

/**
 * Send this layout to somebody (issue #1439). A drawer rather than a dialog, and
 * it carries the record in hand rather than the one on disk, so a share pressed
 * a moment after an edit sends what is on screen.
 */
function ShareBlueprintButton({ record }: { record: StoredBlueprint }) {
  const drawer = useDrawer();

  const share = async () => {
    const { ShareBlueprintForm } = await import(
      "./components/ShareBlueprintForm"
    );
    drawer.open({
      title: `Share ${record.layout.name}`,
      width: "28rem",
      content: <ShareBlueprintForm key={nextDrawerKey()} record={record} />,
    });
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5"
      onClick={() => void share()}
    >
      <Share2 className="size-4" /> Share
    </Button>
  );
}

/**
 * Make a variant of this layout (issue #1452).
 *
 * A copy rather than a fork of what is on disk: it takes the record in hand, so
 * a duplicate pressed a moment after a drag carries the drag. It lands as its
 * own entry and opens, because the reason to copy a layout is to change the
 * copy.
 */
function DuplicateBlueprintButton({
  record,
  taken,
}: {
  record: StoredBlueprint;
  /** Every name in the library, so a copy of "Opening solars" is offered as
   *  "Opening solars 2" rather than as a twin. */
  taken: string[];
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function duplicate() {
    setBusy(true);
    try {
      const copy = duplicatedBlueprint(record, taken);
      await saveBlueprint(copy);
      toast.success(`"${copy.layout.name}" is yours to change.`);
      navigate(blueprintRoute(copy.id));
    } catch (e) {
      toast.error(`That layout could not be copied: ${message(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5"
      disabled={busy}
      onClick={() => void duplicate()}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Copy className="size-4" />
      )}
      Duplicate
    </Button>
  );
}

/**
 * Say this layout in another side's buildings (issue #1314).
 *
 * Next to Share rather than inside the editor, because it is a thing done to the
 * whole layout once rather than a thing done while drawing one, and because what
 * it needs on screen is a list of unit names rather than the surface.
 */
function SubstituteButton({
  record,
  onApply,
}: {
  record: StoredBlueprint;
  onApply: (layout: BaseBlueprint) => void;
}) {
  const drawer = useDrawer();

  const open = async () => {
    const { SubstituteBlueprintForm } = await import(
      "./components/SubstituteBlueprintForm"
    );
    drawer.open({
      title: `Convert ${record.layout.name}`,
      width: "32rem",
      content: (
        <SubstituteBlueprintForm
          key={nextDrawerKey()}
          record={record}
          onApply={(layout) => {
            onApply(layout);
            drawer.close();
          }}
        />
      ),
    });
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5"
      onClick={() => void open()}
    >
      <Repeat className="size-4" /> Convert
    </Button>
  );
}

function DeleteBlueprintButton({
  name,
  onDelete,
}: {
  name: string;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5">
          <Trash2 className="size-4" /> Delete
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Delete this blueprint?</h3>
          <p className="break-words text-xs text-muted-foreground">
            "{name}" goes from your library. A scenario that already placed a
            base from it keeps its own copy.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="gap-1.5"
            disabled={busy}
            onClick={remove}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Delete
          </Button>
        </div>
        {error && (
          <p className="break-words text-xs text-destructive">{error}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
