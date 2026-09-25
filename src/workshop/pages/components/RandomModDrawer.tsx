/**
 * Randomise a game into rarity tiers and start a project from it (issue
 * #1318).
 *
 * A seed, a scope and which fields roll are the whole of what a run needs to
 * be reproducible: `randomMod.ts` says why that is enough, and why there is no
 * "regenerate" button here yet. This drawer is the button beside "New
 * project" and "Import" on the projects list, the same place `DecodeTweakSetDrawer`
 * sits, and it hands back a plain `NewProject` the page opens the same way it
 * opens any other import.
 *
 * Reading the game's unit defs is the one thing this drawer needs that
 * `DecodeTweakSetDrawer` does not: the preview and the plan both need the
 * game's own fields, so the game picker feeds `useUnitDefs` the moment a game
 * is chosen, on the same 23 second read the editor already pays once per
 * session.
 */
import { Button, Drawer, Input } from "@picoframe/frame";
import { Dice5 } from "lucide-react";
import { useMemo, useState } from "react";
import { CheckField, Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { gameIdentityForName } from "@/container/gameIdentity";
import type { GameItem } from "@/content/bindings";
import { GamePickerButton } from "@/play/pages/components/GamePickerButton";
import { GamePickerPanel } from "@/play/pages/components/GamePickerPanel";
import { useUnitDefs } from "../../config";
import type { ModProject, NewProject } from "../../project";
import {
  applyRandomModPlan,
  DEFAULT_TIER_WEIGHTS,
  describeRandomModRules,
  planRandomMod,
  RANDOM_FIELDS,
  RARITY_TIERS,
  type RandomScope,
  randomModChangeCount,
  randomModProjectName,
  randomSeed,
  resolveRandomScope,
  type TierWeights,
} from "../../randomMod";

type ScopeKind = "all" | "query" | "collection";

/** Every collection any of the game's own projects has defined, so a scope
 *  can name one even though the project this drawer is about to start has
 *  none of its own yet. Labelled with the project it came from, since two
 *  projects can both have a collection called "Bots". */
function collectionOptions(
  projects: readonly ModProject[],
  gameName: string,
): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const project of projects) {
    if (project.gameName !== gameName) continue;
    for (const collection of Object.values(project.edits.collections ?? {})) {
      out.push({
        value: `${project.id}:${collection.id}`,
        label: `${collection.name} — ${project.name}`,
      });
    }
  }
  return out;
}

export function RandomModDrawer({
  games,
  headers,
  scanning,
  projects,
  enginePath,
  dataDir,
  onStarted,
}: {
  games: readonly GameItem[];
  headers: Map<string, string>;
  scanning: boolean;
  /** Existing projects against the same game, so a scope can name one of
   *  their collections. */
  projects: readonly ModProject[];
  enginePath?: string;
  dataDir?: string;
  onStarted: (input: NewProject) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        title="Randomise a game's units into rarity tiers and start a project from the result"
      >
        <Dice5 className="mr-1 size-3.5" />
        Randomise
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Randomised mod"
        description="Pick a game, a seed and a scope. Two people who type the same seed and rules against the same game get the same mod."
        width="28rem"
      >
        {open ? (
          <RandomModForm
            games={games}
            headers={headers}
            scanning={scanning}
            projects={projects}
            enginePath={enginePath}
            dataDir={dataDir}
            onStarted={(input) => {
              setOpen(false);
              onStarted(input);
            }}
          />
        ) : null}
      </Drawer>
    </>
  );
}

/** Separate from the drawer, the same way `ProjectDetailsForm` is, so closing
 *  the drawer unmounts it and reopening starts from a fresh seed rather than
 *  wherever the fields were left. */
function RandomModForm({
  games,
  headers,
  scanning,
  projects,
  enginePath,
  dataDir,
  onStarted,
}: {
  games: readonly GameItem[];
  headers: Map<string, string>;
  scanning: boolean;
  projects: readonly ModProject[];
  enginePath?: string;
  dataDir?: string;
  onStarted: (input: NewProject) => void;
}) {
  const [gameName, setGameName] = useState("");
  const [pickingGame, setPickingGame] = useState(false);
  const [seed, setSeed] = useState(() => randomSeed());
  const [scopeKind, setScopeKind] = useState<ScopeKind>("all");
  const [query, setQuery] = useState("");
  const [collectionKey, setCollectionKey] = useState("");
  const [fields, setFields] = useState<string[]>(
    RANDOM_FIELDS.map((f) => f.id),
  );
  const [tierWeights, setTierWeights] = useState<TierWeights>({
    ...DEFAULT_TIER_WEIGHTS,
  });

  const game = games.find((g) => g.name === gameName);
  const { defs, status } = useUnitDefs(
    enginePath,
    dataDir,
    game?.primaryArchive.name,
  );
  const units = defs?.units ?? {};

  const collectionChoices = useMemo(
    () => collectionOptions(projects, gameName),
    [projects, gameName],
  );

  const scope: RandomScope = useMemo(() => {
    if (scopeKind === "query") return { kind: "query", query };
    if (scopeKind === "collection" && collectionKey) {
      const [projectId, collectionId] = collectionKey.split(":");
      const source = projects.find((p) => p.id === projectId);
      return {
        kind: "collection",
        collections: source?.edits.collections ?? {},
        collectionId,
      };
    }
    return { kind: "all" };
  }, [scopeKind, query, collectionKey, projects]);

  const rules = useMemo(
    () => ({ seed, fields, tierWeights }),
    [seed, fields, tierWeights],
  );

  const scopedUnits = useMemo(
    () => (status === "ready" ? resolveRandomScope(scope, units) : []),
    [status, scope, units],
  );
  const plan = useMemo(
    () => planRandomMod(scopedUnits, units, rules),
    [scopedUnits, units, rules],
  );
  const changed = randomModChangeCount(plan);

  if (pickingGame) {
    return (
      <GamePickerPanel
        games={games}
        headers={headers}
        selectedName={gameName}
        onSelect={setGameName}
        onBack={() => setPickingGame(false)}
        backLabel="Back to the randomised mod"
        gamesLoading={scanning}
      />
    );
  }

  function toggleField(id: string, on: boolean) {
    setFields((prev) => (on ? [...prev, id] : prev.filter((f) => f !== id)));
  }

  function submit() {
    if (!gameName || status !== "ready") return;
    const overrides = applyRandomModPlan(plan);
    onStarted({
      name: randomModProjectName(gameName, seed),
      description: describeRandomModRules(rules, scope),
      gameName,
      game: gameIdentityForName(gameName, games) ?? undefined,
      authoredChecksum: defs?.checksum,
      edits: {
        overrides,
        clones: {},
        menus: {},
        text: {},
        disabled: [],
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Game"
        hint="Every roll reads this game's own numbers, so it has to be read first."
      >
        <GamePickerButton
          ariaLabel="Game to randomise"
          placeholder={scanning ? "Scanning…" : "Pick a game"}
          value={gameName}
          games={games}
          headers={headers}
          onClick={() => setPickingGame(true)}
        />
      </Field>

      {gameName && status === "loading" ? (
        <p className="text-muted-foreground text-xs">
          Reading {gameName}'s units…
        </p>
      ) : null}
      {gameName && status === "error" ? (
        <p className="text-destructive text-xs">
          Could not read {gameName}'s units.
        </p>
      ) : null}

      {gameName && status === "ready" ? (
        <>
          <Field
            label="Seed"
            hint="The same seed and rules against this game always produce the same mod."
          >
            <div className="flex gap-2">
              <Input
                type="number"
                aria-label="Seed"
                value={seed}
                onChange={(event) =>
                  setSeed(Math.trunc(Number(event.target.value)) || 0)
                }
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setSeed(randomSeed())}
              >
                New seed
              </Button>
            </div>
          </Field>

          <Field label="Scope" hint="Which units this mod touches.">
            <OptionSelect
              value={scopeKind}
              onValueChange={(value) => setScopeKind(value as ScopeKind)}
              ariaLabel="Scope"
              options={[
                { value: "all", label: "All units" },
                { value: "query", label: "A search query" },
                {
                  value: "collection",
                  label: "A collection",
                  disabled: collectionChoices.length === 0,
                },
              ]}
            />
          </Field>

          {scopeKind === "query" ? (
            <Field
              label="Query"
              hint='The same predicate language the unit search box takes, e.g. "cost < 500".'
            >
              <Input
                aria-label="Search query"
                value={query}
                placeholder="cost < 500"
                onChange={(event) => setQuery(event.target.value)}
              />
            </Field>
          ) : null}

          {scopeKind === "collection" ? (
            <Field
              label="Collection"
              hint={
                collectionChoices.length === 0
                  ? "No collection has been defined against this game yet."
                  : "From any project already started against this game."
              }
            >
              <OptionSelect
                value={collectionKey}
                onValueChange={setCollectionKey}
                ariaLabel="Collection"
                placeholder="Pick a collection"
                options={collectionChoices}
              />
            </Field>
          ) : null}

          <Field
            label="Fields"
            hint="Skips a unit that has none of these as a real number."
          >
            <div className="flex flex-col gap-2">
              {RANDOM_FIELDS.map((field) => (
                <CheckField
                  key={field.id}
                  label={field.label}
                  checked={fields.includes(field.id)}
                  onChange={(v) => toggleField(field.id, v)}
                />
              ))}
            </div>
          </Field>

          <Field
            label="Tier weights"
            hint="How often a unit lands each rarity. Not required to add up to 100."
          >
            <div className="flex flex-col gap-2">
              {RARITY_TIERS.map((tier) => (
                <div
                  key={tier.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    {tier.label} (×{tier.factorMin}–{tier.factorMax})
                  </span>
                  <Input
                    type="number"
                    min={0}
                    className="w-20"
                    aria-label={`${tier.label} weight`}
                    value={tierWeights[tier.id] ?? 0}
                    onChange={(event) =>
                      setTierWeights((prev) => ({
                        ...prev,
                        [tier.id]: Math.max(0, Number(event.target.value) || 0),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </Field>

          <div className="flex flex-col gap-1 rounded border border-border bg-muted/30 p-2 text-xs">
            <span>
              {scopedUnits.length} unit{scopedUnits.length === 1 ? "" : "s"} in
              scope, {changed} will change.
            </span>
            <ul className="flex flex-col gap-0.5 text-muted-foreground">
              {plan
                .filter((row) => row.changes.length > 0)
                .slice(0, 5)
                .map((row) => (
                  <li key={row.unit}>
                    {row.unit} — {row.tier}:{" "}
                    {row.changes
                      .map((c) => `${c.field} ${c.before}→${c.after}`)
                      .join(", ")}
                  </li>
                ))}
            </ul>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={submit}
              disabled={
                scopedUnits.length === 0 ||
                fields.length === 0 ||
                (scopeKind === "collection" && !collectionKey)
              }
            >
              <Dice5 className="size-4" />
              Create project
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
