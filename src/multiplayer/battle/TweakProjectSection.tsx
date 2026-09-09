/**
 * Send a workshop project into the battle that is open, from inside the battle
 * options drawer (issue #1279).
 *
 * It sits here rather than in the workshop's own Package drawer because every
 * question it has to answer is about a battle, not about a project: which room,
 * which server, whether this game has tweak slots at all, and what the room is
 * already holding. The workshop keeps its copy-a-line-at-a-time export for
 * anyone pasting into a lobby coilbox is not connected to. And tweak slots are
 * mod options, so this is the drawer they belong in.
 *
 * There are three ways a project reaches a match and only two of them are here.
 * When the game declares tweak slots, the compiled project goes into them, and
 * whether that travels as `!bSet` chat or as a script tag the founder writes is
 * `sendOption`'s existing fork, not a difference this section makes. When the
 * game declares none, the route is a mutator archive instead, and every client
 * needs a copy of it. Getting the archive to them is issue #1284, so this says
 * so and points at the Package drawer rather than pretending.
 *
 * An incomplete pack is never sent. `bar_pack` reports what it could not place,
 * and half a set in a live room is the failure this whole issue is about, so a
 * pack with anything missing is refused here rather than sent and warned about.
 */
import { Button } from "@picoframe/frame";
import { Send, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import type { ConfigOption } from "@/content/bindings";
import { barSlotFit, workshopPackBarSlots } from "@/workshop/barPack";
import { ledgerByOutput, useChangeLedger } from "@/workshop/changeLedger";
import { deliveryRoutes } from "@/workshop/deliveryRoutes";
import { type ModProject, useModProjects } from "@/workshop/project";
import { DeliveryProgressPanel } from "./DeliveryProgressPanel";
import { deliverySlots, ledgerKeyFor } from "./tweakDelivery";
import { useTweakDelivery } from "./useTweakDelivery";

export function TweakProjectSection({
  gameName,
  modOptionsSchema,
  scriptTags,
  battleId,
  isFounder,
  canEdit,
}: {
  /** The battle's game, which is what a project is written against. */
  gameName: string;
  modOptionsSchema: ConfigOption[];
  /** The battle's confirmed tags, for saying what is already set before a run. */
  scriptTags: Record<string, string>;
  battleId: number | null;
  isFounder: boolean;
  canEdit: boolean;
}) {
  const { projects } = useModProjects();
  const delivery = useTweakDelivery({ battleId, isFounder });
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [packing, setPacking] = useState(false);

  const mine = useMemo(
    () => projects.filter((p) => p.gameName === gameName),
    [projects, gameName],
  );
  const project: ModProject | undefined = mine.find((p) => p.id === chosen);

  const tweakRoute = deliveryRoutes(modOptionsSchema, gameName).find(
    (r) => r.route === "tweak-slots",
  );

  // Only read the ledger once there is something to explain with it. It
  // recompiles the project, which is not worth doing for a run that worked.
  const failed = delivery.progress?.slots.find((s) => s.state === "failed");
  const ledger = useChangeLedger(project, !!failed);

  const unsentKeys = new Set(
    (delivery.progress?.slots ?? [])
      .filter((s) => s.state === "failed" || s.state === "skipped")
      .map((s) => ledgerKeyFor(s.slot)),
  );
  const strandedEdits = ledger.ledger
    ? ledgerByOutput(ledger.ledger).filter((row) => unsentKeys.has(row.key))
    : [];

  async function run() {
    if (!project) return;
    setError(null);
    delivery.clear();
    setPacking(true);
    try {
      const pack = await workshopPackBarSlots({ project });
      const fit = barSlotFit(pack, modOptionsSchema);
      const missing = pack.oversized.length + pack.unplaced.length;
      if (missing > 0 || !fit.fits) {
        setError(
          `This project does not pack into the slots ${gameName} has, so none of it was sent. Open it in the workshop and use Package to see which edits will not fit.`,
        );
        return;
      }
      const slots = deliverySlots(pack);
      if (slots.length === 0) {
        setError("This project has nothing that packs into a tweak slot.");
        return;
      }
      setPacking(false);
      await delivery.start(slots);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPacking(false);
    }
  }

  return (
    <section>
      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Workshop project
      </div>

      {tweakRoute && !tweakRoute.available ? (
        <p className="text-xs text-muted-foreground">
          {gameName} declares no tweak slots, so there is nothing here for a
          project to be set into. A project for it travels as a mutator archive,
          which every player in the battle needs their own copy of before the
          match can start, so it cannot be pushed into the room from here.
          Package it from the workshop and share the file.
        </p>
      ) : mine.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No workshop projects for {gameName} yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {isFounder
              ? "Sets the compiled slots on this battle as mod options, one at a time, and waits for each to come back before sending the next."
              : "Asks the autohost to set the compiled slots, one !bSet at a time. Paced so the autohost does not read it as a flood, and each slot is checked against what the battle actually holds."}
          </p>

          <OptionSelect
            value={chosen}
            onValueChange={setChosen}
            disabled={!canEdit || delivery.running || packing}
            ariaLabel="Which project to send"
            placeholder="Pick a project"
            options={mine.map((p) => ({
              value: p.id,
              label: p.name,
              description: p.description,
            }))}
          />

          <Button
            size="sm"
            disabled={!canEdit || !project || delivery.running || packing}
            onClick={() => void run()}
          >
            {delivery.running ? (
              <Send className="size-4" />
            ) : (
              <Upload className="size-4" />
            )}
            {packing
              ? "Packing"
              : delivery.running
                ? "Sending"
                : "Send to this battle"}
          </Button>

          {delivery.running && (
            <Button
              size="sm"
              variant="outline"
              onClick={delivery.cancel}
              title="Stop before the next slot. Whatever has already been set stays set."
            >
              Stop
            </Button>
          )}

          {!canEdit && (
            <p className="text-xs text-muted-foreground">
              Only the host or the room's boss can set battle options.
            </p>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          {delivery.progress && (
            <>
              <DeliveryProgressPanel
                progress={delivery.progress}
                retryHint="Do not start the match on what is set now. Running it again finishes the set and skips the slots this battle already holds, so a second run only sends what is missing."
              />
              {strandedEdits.length > 0 && (
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <p>These edits are not in the battle:</p>
                  <ul className="list-disc pl-4">
                    {strandedEdits.map((row) => (
                      <li key={row.key}>
                        {row.label}:{" "}
                        {row.entries
                          .slice(0, 4)
                          .map((e) => e.unit)
                          .join(", ")}
                        {row.entries.length > 4
                          ? ` and ${row.entries.length - 4} more`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {!delivery.progress && project && (
            <AlreadyHolding scriptTags={scriptTags} />
          )}
        </div>
      )}
    </section>
  );
}

/** What the room is holding before a run starts, so somebody can see they are
 *  walking into a room that already has somebody else's set in it. */
function AlreadyHolding({
  scriptTags,
}: {
  scriptTags: Record<string, string>;
}) {
  const held = Object.keys(scriptTags).filter((k) =>
    /^game\/modoptions\/tweak(defs|units)\d*$/i.test(k),
  );
  if (held.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      This battle already has {held.length} tweak slot
      {held.length === 1 ? "" : "s"} set. Sending a project leaves any slot it
      does not use exactly as it is.
    </p>
  );
}
