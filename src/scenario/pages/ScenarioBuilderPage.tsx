import { Button, Input } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { scenarioExport, scenarioImport } from "../bindings";
import { newScenario } from "../create";
import type { Scenario } from "../model";
import { refreshScenarios, useScenarios } from "../scenarios";
import {
  deleteScenario,
  exportScenario,
  importScenario,
  saveScenario,
} from "../storage";
import { scenarioImportErrorMessage } from "../transfer";

/** What a scenario holds, for the list row's second line. */
function contentsLine(scenario: Scenario): string {
  const counts = [
    [scenario.actors.length + scenario.groups.length, "unit placement"],
    [scenario.zones.length, "zone"],
    [scenario.triggers.length, "trigger"],
    [scenario.objectives.length, "objective"],
  ] as const;
  return counts
    .map(([n, noun]) => `${n} ${noun}${n === 1 ? "" : "s"}`)
    .join(" · ");
}

/**
 * Scenario Builder landing: create a scenario, import a shared one, and list
 * every stored scenario with the route into its editor. Advanced-gated by its
 * route, beside Campaign Builder.
 *
 * A scenario is the in-engine half of a mission (spawns, zones, triggers,
 * objectives, dialogue) and a standalone document, so it is created here and
 * only later attached to a campaign mission.
 */
export default function ScenarioBuilderPage() {
  const { scenarios, loading, error, refresh } = useScenarios();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const saved = await saveScenario(
        newScenario(trimmed, description.trim()),
      );
      await refreshScenarios();
      setName("");
      setDescription("");
      navigate(`/scenario-builder/${saved.id}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Import mints a fresh id and writes the dialogue clips carried in the file,
  // so importing the scenario you exported gives you a second copy rather than
  // overwriting the first.
  const importFile = async () => {
    setActionError(null);
    try {
      const src = await open({
        title: "Import scenario",
        multiple: false,
        filters: [{ name: "Coilbox scenario", extensions: ["json"] }],
      });
      if (typeof src !== "string") return;
      setBusy(true);
      const { text } = await scenarioImport({ src });
      const result = await importScenario(text);
      if (!result.ok) {
        setActionError(scenarioImportErrorMessage(result.error));
        return;
      }
      await refreshScenarios();
      navigate(`/scenario-builder/${result.payload.id}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportFile = async (scenario: Scenario) => {
    setActionError(null);
    try {
      const text = await exportScenario(scenario);
      const dest = await save({
        title: "Export scenario",
        defaultPath: `${scenario.name || "scenario"}.json`,
        filters: [{ name: "Coilbox scenario", extensions: ["json"] }],
      });
      if (!dest) return;
      await scenarioExport({ text, dest });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    setActionError(null);
    try {
      await deleteScenario(id);
      await refreshScenarios();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Scenario Builder</h1>
        <p className="text-sm text-muted-foreground">
          Author a mission's in-engine content: what spawns, what the triggers
          watch for, and what wins it. A scenario stands alone, so you can play
          one on its own or attach it to a campaign mission later.
        </p>
      </header>

      {actionError && <ErrorBanner message={actionError} />}
      {error && <ErrorBanner message={error} />}

      <section className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-4">
        <h2 className="text-sm font-medium">New scenario</h2>
        <Input
          value={name}
          placeholder="Name"
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          value={description}
          placeholder="Description (optional)"
          className="min-h-16"
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            className="gap-1.5"
            onClick={create}
            disabled={!name.trim() || busy}
          >
            <Plus className="size-4" /> Create
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={importFile}
            disabled={busy}
          >
            <Download className="size-4" /> Import
          </Button>
        </div>
      </section>

      {loading ? (
        <SkeletonList />
      ) : scenarios.length === 0 ? (
        <EmptyState label="No scenarios yet. Create or import one above." />
      ) : (
        <ul className="flex flex-col gap-2">
          {scenarios.map((scenario) => (
            <li
              key={scenario.id}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">
                  {scenario.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {scenario.setup.gameName || "No game"} ·{" "}
                  {scenario.setup.mapName || "No map"}
                </span>
                <span className="truncate text-xs text-muted-foreground/80">
                  {contentsLine(scenario)}
                </span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => navigate(`/scenario-builder/${scenario.id}`)}
                >
                  <Pencil className="size-4" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => void exportFile(scenario)}
                >
                  <Upload className="size-4" /> Export
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${scenario.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="flex w-56 flex-col gap-2">
                    <p className="text-sm">
                      Delete{" "}
                      <span className="font-medium">{scenario.name}</span> and
                      its dialogue clips? This can't be undone.
                    </p>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => remove(scenario.id)}
                    >
                      Delete
                    </Button>
                  </PopoverContent>
                </Popover>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && (
        <button
          type="button"
          onClick={refresh}
          className="self-start text-xs text-muted-foreground hover:underline"
        >
          Refresh
        </button>
      )}
    </div>
  );
}
