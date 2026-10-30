import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appFileIO } from "@/blueprint/fileIO";
import { SlideDrawer } from "@/components/SlideDrawer";
import { Switch } from "@/components/ui/switch";
import { errorText } from "@/lib/helpers";
import { usePlay } from "@/play/PlayProvider";
import type { WidgetHandler } from "../handlers";
import type { WidgetRow } from "../widgetList";
import {
  type WidgetSettings as Loaded,
  loadWidgetSettings,
  type SettingEdit,
  type SettingNode,
  saveWidgetSettings,
} from "../widgetSettings";

/** What the drawer needs to know about the game and widget it shows. */
export interface SettingsTarget {
  row: WidgetRow;
  /** Set for a row with a switch, which is the name its settings are saved
   *  under. */
  sw: Extract<WidgetRow["switch"], { kind: "ready" }>;
  game: string;
  shortName?: string;
  handler: WidgetHandler;
}

/** A draft value: a number is kept as the text being typed. */
type Draft = string | boolean;

const key = (path: readonly number[]) => path.join(".");

function* leaves(node: SettingNode): Generator<SettingNode> {
  if (node.kind === "table") {
    for (const child of node.children) yield* leaves(child);
  } else {
    yield node;
  }
}

/** The edits the drafts make, and whether any draft is not a value its setting
 *  can take. A draft equal to what is saved is no edit. */
function editsOf(
  root: SettingNode,
  drafts: Readonly<Record<string, Draft>>,
): { edits: SettingEdit[]; invalid: boolean } {
  const edits: SettingEdit[] = [];
  let invalid = false;
  for (const node of leaves(root)) {
    const draft = drafts[key(node.path)];
    if (draft === undefined) continue;
    const { path, trail } = node;
    if (node.kind === "number" && typeof draft === "string") {
      const n = Number(draft);
      if (draft.trim() === "" || !Number.isFinite(n)) invalid = true;
      else if (n !== node.value) {
        edits.push({ path, trail, was: node.value, value: n });
      }
    } else if (node.kind === "string" && typeof draft === "string") {
      if (draft !== node.value) {
        edits.push({ path, trail, was: node.value, value: draft });
      }
    } else if (node.kind === "boolean" && typeof draft === "boolean") {
      if (draft !== node.value) {
        edits.push({ path, trail, was: node.value, value: draft });
      }
    }
  }
  return { edits, invalid };
}

function isInvalidNumber(draft: Draft | undefined): boolean {
  return (
    typeof draft === "string" &&
    (draft.trim() === "" || !Number.isFinite(Number(draft)))
  );
}

interface TreeProps {
  drafts: Readonly<Record<string, Draft>>;
  setDraft: (node: SettingNode, draft: Draft) => void;
  disabled: boolean;
}

function Leaf({
  node,
  drafts,
  setDraft,
  disabled,
}: TreeProps & { node: SettingNode }) {
  const { t } = useLingui();
  const draft = drafts[key(node.path)];
  const type =
    node.kind === "number"
      ? t`number`
      : node.kind === "string"
        ? t`text`
        : node.kind === "boolean"
          ? t`true or false`
          : t`not edited`;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="min-w-0 flex-1 break-all font-mono text-xs">
        {node.label}
      </span>
      <span className="text-xs text-muted-foreground">{type}</span>
      <div className="flex w-36 justify-end">
        {node.kind === "boolean" && (
          <Switch
            checked={typeof draft === "boolean" ? draft : node.value}
            onCheckedChange={(on) => setDraft(node, on)}
            disabled={disabled}
            aria-label={node.label}
          />
        )}
        {node.kind === "number" && (
          <Input
            className="h-8 text-xs"
            inputMode="decimal"
            value={typeof draft === "string" ? draft : String(node.value)}
            onChange={(e) => setDraft(node, e.target.value)}
            disabled={disabled}
            aria-label={node.label}
            aria-invalid={isInvalidNumber(draft)}
          />
        )}
        {node.kind === "string" && (
          <Input
            className="h-8 text-xs"
            value={typeof draft === "string" ? draft : node.value}
            onChange={(e) => setDraft(node, e.target.value)}
            disabled={disabled}
            aria-label={node.label}
          />
        )}
        {node.kind === "other" && (
          <code className="break-all text-xs">{node.text}</code>
        )}
      </div>
    </div>
  );
}

function Branch({
  node,
  depth,
  ...rest
}: TreeProps & { node: SettingNode; depth: number }) {
  const { t } = useLingui();
  // The top level is open, and anything inside it opens when asked, so a long
  // table does not put hundreds of fields on the page at once.
  const [open, setOpen] = useState(depth === 0);
  if (node.kind !== "table") return <Leaf node={node} {...rest} />;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1 py-1 text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Chevron className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 break-all font-mono text-xs">
          {node.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {t`table of ${node.children.length}`}
        </span>
      </button>
      {open && (
        <fieldset className="ml-2 min-w-0 border-l border-border pl-2">
          <legend className="sr-only">{node.label}</legend>
          {node.children.map((child) => (
            <Branch
              key={key(child.path)}
              node={child}
              depth={depth + 1}
              {...rest}
            />
          ))}
        </fieldset>
      )}
    </div>
  );
}

function SettingsBody({
  target,
  writeDir,
  widgetDir,
}: {
  target: SettingsTarget;
  writeDir: string;
  widgetDir: string;
}) {
  const { t } = useLingui();
  const { running } = usePlay();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const request = useMemo(
    () => ({
      io: appFileIO,
      writeDir,
      config: target.handler.config,
      shortName: target.shortName ?? "",
      sw: target.sw,
    }),
    [writeDir, target],
  );

  const load = useCallback(async () => {
    try {
      setLoaded(
        await loadWidgetSettings({
          ...request,
          widgetDir,
          widgetPath: target.row.path,
        }),
      );
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [request, widgetDir, target.row.path]);

  useEffect(() => {
    void load();
  }, [load]);

  const root = loaded?.kind === "ready" ? loaded.root : null;
  const { edits, invalid } = root
    ? editsOf(root, drafts)
    : { edits: [], invalid: false };

  const setDraft = (node: SettingNode, draft: Draft) => {
    setSaved(null);
    setDrafts((d) => ({ ...d, [key(node.path)]: draft }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const out = await saveWidgetSettings({
        ...request,
        edits,
        gameRunning: running,
      });
      setSaved(out.backup ?? "");
      setDrafts({});
      setError(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <p role="alert" className="mb-3 break-words text-sm text-destructive">
            {error}
          </p>
        )}
        {!loaded && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            <Trans>Reading</Trans>
          </p>
        )}
        {loaded?.kind === "none" && (
          <p role="status" className="text-sm text-muted-foreground">
            <Trans>This widget has no saved settings.</Trans>
          </p>
        )}
        {loaded?.kind === "unsaved" && (
          <p role="status" className="text-sm text-muted-foreground">
            {t`Nothing saved yet. ${target.game} saves this widget's settings after the widget has run.`}
          </p>
        )}
        {running && loaded?.kind === "ready" && (
          <p role="status" className="mb-3 text-sm text-muted-foreground">
            <Trans>A game is running. Close it to change these settings.</Trans>
          </p>
        )}
        {loaded?.kind === "ready" && (
          <>
            <p className="mb-2 break-all font-mono text-xs text-muted-foreground">
              {loaded.path}
            </p>
            <Branch
              node={loaded.root}
              depth={0}
              drafts={drafts}
              setDraft={setDraft}
              disabled={running || saving}
            />
          </>
        )}
        {saved !== null && (
          <p role="status" className="mt-3 break-all text-sm">
            {saved
              ? t`Saved. The file as it was is at ${saved}.`
              : t`Nothing changed.`}
          </p>
        )}
      </div>
      {loaded?.kind === "ready" && (
        <div className="flex gap-2 border-t border-border p-4">
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={running || saving || invalid || edits.length === 0}
          >
            <Trans>Save</Trans>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDrafts({})}
            disabled={saving || Object.keys(drafts).length === 0}
          >
            <Trans>Discard changes</Trans>
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The settings a widget has saved in a game (issue #1291), in a drawer beside
 * the widget list. Edits are drafted and written together by Save, so one save
 * is one copy of the game's file.
 */
export function WidgetSettingsDrawer({
  target,
  writeDir,
  widgetDir,
  onClose,
}: {
  target: SettingsTarget | null;
  /** The engine's write folder, where the game keeps the settings. */
  writeDir: string | undefined;
  /** The folder the widget's `LuaUI/` is in. */
  widgetDir: string | undefined;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const name = target?.sw.name ?? "";
  return (
    <SlideDrawer
      open={target !== null && !!writeDir && !!widgetDir}
      title={t`${name} settings`}
      onClose={onClose}
    >
      {target && writeDir && widgetDir && (
        <SettingsBody
          key={`${target.game}\u0000${target.row.path}`}
          target={target}
          writeDir={writeDir}
          widgetDir={widgetDir}
        />
      )}
    </SlideDrawer>
  );
}
