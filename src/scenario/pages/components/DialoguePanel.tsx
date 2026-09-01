/**
 * The dialogue panel: the radio messages a trigger plays, and the portrait and
 * voice clip each one carries.
 *
 * A line is not shown by being written. A `dialogue` action names one and the
 * runtime plays it, so this panel is the words and the media, and the trigger
 * panel is when.
 *
 * `portrait` and `audio` are bare file names, not paths and not data URIs,
 * because LuaUI loads them out of the game's VFS beside the compiled mission.
 * Importing one copies the author's file into the scenario's own media folder
 * under a minted name, so the document never depends on where the author keeps
 * their art.
 *
 * The preview reads that stored file back over the `coilbox://` protocol's
 * `scenario` root, so a voice clip streams and seeks like any other audio
 * source instead of arriving as one base64 string.
 */

import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ImageIcon,
  MessageSquare,
  Plus,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useFieldText } from "@/lib/useFieldText";
import { loadedCampaigns } from "../../../campaign/campaigns";
import { clipIsAttached } from "../../../campaign/scenarioMedia";
import { scenarioMediaUrl } from "../../../lib/assetUrl";
import type { ExtensionTypes } from "../../extensions";
import type { Scenario, ScenarioDialogue } from "../../model";
import { deleteScenarioMedia, importScenarioMedia } from "../../storage";
import { EditorPanel, NameField, TextField } from "./panels";
import {
  addDialogue,
  dialogueMedia,
  editDialogue,
  nextDialogueId,
  portraitDrawable,
  removeDialogue,
  renameDialogue,
} from "./registries";

/** What the file dialog offers for each of the two clips. The engine reads more
 *  image formats than these, but these are the ones a portrait is drawn in.
 *  `dds` stays on the list because it is what a game's own art is shipped as,
 *  even though the preview cannot show one: see {@link portraitDrawable}. */
const FILTERS = {
  portrait: { name: "Image", extensions: ["png", "jpg", "jpeg", "dds", "bmp"] },
  audio: { name: "Audio", extensions: ["ogg", "wav", "mp3"] },
};

/**
 * Drop a clip the line no longer names, unless a campaign mission still names it
 * (issue #871).
 *
 * The editor owns the scenario document, but not the missions that snapshotted
 * it, and such a mission loads its portraits and voices by file name out of this
 * same store. So a clip one of them still names is left orphaned rather than
 * deleted, which is the trade issue #866 made for a whole deleted scenario. The
 * campaign list is read at delete time rather than through `useCampaigns`,
 * because a cold cache would read as "no campaigns" and delete the file.
 */
async function dropClip(scenarioId: string, file: string): Promise<void> {
  const campaigns = await loadedCampaigns();
  const attached = clipIsAttached(
    campaigns.map((c) => c.campaign),
    scenarioId,
    file,
  );
  if (!attached) await deleteScenarioMedia(scenarioId, file);
}

export function DialoguePanel({
  scenario,
  onChange,
  extensions,
}: {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
  /** The types the scenario's game declares, so a rename carries over a
   *  reference one of its own parameters holds (issue #913). */
  extensions: ExtensionTypes;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    scenario.dialogue.find((d) => d.id === selectedId) ??
    scenario.dialogue[0] ??
    null;

  const count = scenario.dialogue.length;
  const create = () => {
    const id = nextDialogueId(scenario.dialogue);
    onChange(addDialogue(scenario, id));
    setSelectedId(id);
  };

  return (
    <EditorPanel
      title="Dialogue"
      icon={MessageSquare}
      summary={
        count === 0
          ? "Nobody says anything yet"
          : `${count} line${count === 1 ? "" : "s"}`
      }
    >
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex shrink-0 flex-col gap-2 lg:w-60">
          {count === 0 ? (
            <p className="text-xs text-muted-foreground">
              A line is a radio message: who is speaking, what they say, and the
              portrait and voice clip that go with it. A trigger's{" "}
              <code>dialogue</code> action plays one.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {scenario.dialogue.map((line) => (
                <li key={line.id}>
                  <DialogueRow
                    line={line}
                    current={line.id === selected?.id}
                    onSelect={() => setSelectedId(line.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={create}
          >
            <Plus className="size-3.5" /> New line
          </Button>
        </div>

        {selected && (
          <div className="min-w-0 flex-1">
            <DialogueForm
              key={selected.id}
              line={selected}
              scenario={scenario}
              extensions={extensions}
              onChange={onChange}
              onSelect={setSelectedId}
            />
          </div>
        )}
      </div>
    </EditorPanel>
  );
}

/** One line in the list: who says it, and what they say. */
function DialogueRow({
  line,
  current,
  onSelect,
}: {
  line: ScenarioDialogue;
  current: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left ${
        current
          ? "border-primary/60 bg-primary/10"
          : "border-border/50 hover:bg-muted/40"
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {line.speaker.trim() || (
            <span className="font-normal text-muted-foreground">
              No speaker yet
            </span>
          )}
        </span>
        {line.portrait && <ImageIcon className="size-3 shrink-0 opacity-60" />}
        {line.audio && <Volume2 className="size-3 shrink-0 opacity-60" />}
      </span>
      <span className="truncate text-[11px] text-muted-foreground">
        {line.text.trim() || line.id}
      </span>
    </button>
  );
}

/** The selected line: its name, who says it, what they say, and its clips. */
function DialogueForm({
  line,
  scenario,
  extensions,
  onChange,
  onSelect,
}: {
  line: ScenarioDialogue;
  scenario: Scenario;
  extensions: ExtensionTypes;
  onChange: (next: Scenario) => void;
  onSelect: (id: string | null) => void;
}) {
  // The words are held here while they are typed and written when the box is
  // left, because every change is saved. That copy follows the line when the
  // line changes on its own, which is what an undo does (issue #2185): the form
  // is keyed by the line's id and the words are not the id, so nothing remounts
  // it and the box carried on showing the words from before the step back.
  const [text, setText] = useFieldText(line.text);
  const [error, setError] = useState<string | null>(null);

  const edit = (patch: Partial<Omit<ScenarioDialogue, "id">>) =>
    onChange(editDialogue(scenario, line.id, patch));

  /** Copy a file the author picked into the scenario's media folder, and drop
   *  whatever the line held before, so a replaced clip is not left on disk. A
   *  clip a campaign mission still names is kept, because that mission plays it
   *  by name out of this same store (issue #871). */
  const importMedia = async (field: "portrait" | "audio") => {
    setError(null);
    try {
      const src = await open({ multiple: false, filters: [FILTERS[field]] });
      if (typeof src !== "string") return;
      const file = await importScenarioMedia(scenario.id, src);
      const previous = line[field];
      edit({ [field]: file });
      if (previous) await dropClip(scenario.id, previous);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const dropMedia = async (field: "portrait" | "audio") => {
    const file = line[field];
    edit({ [field]: undefined });
    if (file) {
      try {
        await dropClip(scenario.id, file);
      } catch {
        // The reference is gone either way, so a clip left on disk is not worth
        // stopping the author over.
      }
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <NameField
          name={line.id}
          label="Dialogue line name"
          onRename={(wanted) => {
            const next = renameDialogue(scenario, line.id, wanted, extensions);
            if (next === scenario) return false;
            onChange(next);
            onSelect(wanted.trim());
            return true;
          }}
        />
        <TextField
          value={line.speaker}
          label="Speaker"
          placeholder="Speaker"
          onCommit={(speaker) => edit({ speaker })}
          className="h-7 w-44 text-xs"
        />
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
          onClick={() => {
            const clips = dialogueMedia(line);
            onChange(removeDialogue(scenario, line.id));
            onSelect(null);
            for (const file of clips) {
              void dropClip(scenario.id, file).catch(() => {});
            }
          }}
        >
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </div>

      <Textarea
        aria-label="What is said"
        value={text}
        placeholder="Contact! Raiders inbound from the north pass."
        className="min-h-16 text-xs"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== line.text) edit({ text });
        }}
      />

      {error && (
        <p className="rounded bg-destructive/15 px-2 py-1.5 text-[11px] text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Keyed on the file so replacing a clip starts over rather than
            inheriting the previous one's load failure. */}
        <MediaField
          key={`portrait:${line.portrait ?? ""}`}
          field="portrait"
          file={line.portrait}
          scenarioId={scenario.id}
          onImport={() => void importMedia("portrait")}
          onDrop={() => void dropMedia("portrait")}
        />
        <MediaField
          key={`audio:${line.audio ?? ""}`}
          field="audio"
          file={line.audio}
          scenarioId={scenario.id}
          onImport={() => void importMedia("audio")}
          onDrop={() => void dropMedia("audio")}
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        A clip is copied into this scenario, so the author's own file can move
        afterwards. Both travel with an export, and both are written beside the
        compiled mission at launch, where the engine loads them by name.
      </p>
    </div>
  );
}

/** One of a line's two clips: what it holds, what it looks or sounds like, and
 *  the buttons that change it. */
function MediaField({
  field,
  file,
  scenarioId,
  onImport,
  onDrop,
}: {
  field: "portrait" | "audio";
  file: string | undefined;
  scenarioId: string;
  onImport: () => void;
  onDrop: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const Icon = field === "portrait" ? ImageIcon : Volume2;

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-2 rounded-md border border-border/50 p-2">
      <header className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <h3 className="text-xs font-medium">
          {field === "portrait" ? "Portrait" : "Voice clip"}
        </h3>
        {file && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto size-6 p-0 text-destructive hover:text-destructive"
            aria-label={`Remove the ${field}`}
            onClick={onDrop}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </header>

      {file ? (
        <>
          {failed ? (
            <p className="text-[11px] text-amber-300">
              The file is in the document but could not be read back, so it will
              be missing from the mission too.
            </p>
          ) : field === "portrait" && !portraitDrawable(file) ? (
            <p className="text-[11px] text-muted-foreground">
              DDS is a format the engine reads and no browser engine does, so
              coilbox cannot show it here. The mission still gets it.
            </p>
          ) : field === "portrait" ? (
            <img
              src={scenarioMediaUrl(scenarioId, file)}
              alt="The portrait this line shows"
              className="size-24 rounded border border-border/50 object-cover"
              onError={() => setFailed(true)}
            />
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: the caption of a voice clip is the line's own text, which is in the box above it
            <audio
              src={scenarioMediaUrl(scenarioId, file)}
              controls
              className="w-full"
              onError={() => setFailed(true)}
            />
          )}
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {file}
          </p>
        </>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={onImport}
        >
          <Plus className="size-3.5" />
          {field === "portrait" ? "Import an image" : "Import a clip"}
        </Button>
      )}
    </section>
  );
}
