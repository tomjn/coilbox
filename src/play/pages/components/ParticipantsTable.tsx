import { Button } from "@picoframe/frame";
import { AlertTriangle, Dices, X } from "lucide-react";
import { OptionSelect } from "@/components/OptionSelect";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Side, SkirmishAi } from "@/content/bindings";
import { FactionLogo } from "@/factions/FactionLogo";
import type { FactionLogoSrc } from "@/factions/fallback";
import { cn } from "@/lib/utils";
import {
  aiPips,
  type GameAiConfig,
  minigamePips,
  orderedAis,
} from "@/play/gameAi";
import {
  aiByline,
  effectiveTeams,
  hexToRgb,
  type Participant,
  RANDOM_SIDE,
  rgbToHex,
  showsFactionColumn,
} from "../../config";
import { DifficultyPips } from "./DifficultyPips";

/** Ally-team letters (A, B, C…) mapped to indices, offered per row. */
const allyLetter = (n: number) => String.fromCharCode(65 + n);

/** Encode/decode an AI select value as `kind:shortName`. */
const aiValue = (a: { kind: string; shortName: string }) =>
  `${a.kind}:${a.shortName}`;

/**
 * Display label for an AI, dropping a redundant "(game-specific AI)" suffix —
 * the "Game AIs" group heading already conveys that.
 */
const aiLabel = (a: { name?: string; shortName: string }) =>
  (a.name ?? a.shortName).replace(/\s*\(game-specific AI\)\s*$/i, "");

export function ParticipantsTable({
  participants,
  sides,
  factionLogos,
  ais,
  aiConfig,
  disabled,
  startPosType,
  startPosCount,
  onUpdate,
  onSetTeam,
  onRemove,
  onAddAi,
}: {
  participants: Participant[];
  sides: Side[];
  /** Resolved faction emblems, keyed by lowercased side name (may be empty). */
  factionLogos?: Record<string, FactionLogoSrc>;
  ais: SkirmishAi[];
  /** The game's AI catalogue, for the difficulty pips and AI ordering. */
  aiConfig?: GameAiConfig;
  disabled?: boolean;
  /** Current start-position mode; 0 (fixed map positions) shows the hint that
   * the team number picks the spawn. */
  startPosType: number;
  /** How many fixed start positions the selected map defines (when known). */
  startPosCount?: number;
  onUpdate: (id: string, patch: Partial<Participant>) => void;
  /** Assign a row to a team slot (0-based); duplicates share the team. */
  onSetTeam: (id: string, team: number) => void;
  onRemove: (id: string) => void;
  onAddAi: () => void;
}) {
  // Effective (compacted) team index per participant, plus each team's leader —
  // the row whose ally/colour/side the engine team takes when rows share a slot.
  const { teamIndexById, leaderIdByTeam } = effectiveTeams(participants);
  const byId = new Map(participants.map((p) => [p.id, p]));
  const leaderOf = (p: Participant): Participant => {
    const idx = teamIndexById.get(p.id);
    return (idx !== undefined && byId.get(leaderIdByTeam[idx])) || p;
  };
  const activeCount = teamIndexById.size;
  // Display order groups rows by effective team so a reassignment (and the
  // compaction it triggers) reads at a glance; a spectating "you" sinks to the
  // bottom. Display-only — the model keeps its row order (participants[0] is
  // always "you"), which team leadership and legacy row-order teams rely on.
  const displayOrder = [...participants].sort(
    (a, b) =>
      (teamIndexById.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (teamIndexById.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );

  // Random sits first so any row (not just newly added AIs) can roll a faction;
  // it resolves to a concrete side per-participant at launch.
  const sideOptions = [
    {
      value: RANDOM_SIDE,
      label: "Random",
      icon: <Dices className="size-4 text-muted-foreground" />,
    },
    ...sides.map((s) => {
      const logo = factionLogos?.[s.name.toLowerCase()];
      return {
        value: s.name,
        label: s.name,
        icon: logo ? (
          <FactionLogo logo={logo} sideName={s.name} size={16} />
        ) : undefined,
      };
    }),
  ];
  // Offer allies up to the participant count so any FFA/teams split is reachable.
  const allyOptions = participants.map((_, i) => ({
    value: String(i),
    label: `Ally ${allyLetter(i)}`,
  }));
  // Offer team slots up to the active count: enough for full FFA, and picking a
  // taken number is how two rows come to share a team (shared unit control).
  // Existing teams show their (leader's) colour in the open dropdown so "join
  // the red team" reads directly; a not-yet-used slot keeps a blank spacer so
  // the numbers stay aligned. The swatch is dropdown-only (`SelectItem` icon),
  // keeping the closed trigger a plain number.
  const teamOptions = Array.from({ length: activeCount }, (_, i) => {
    const teamLeader = byId.get(leaderIdByTeam[i]);
    return {
      value: String(i),
      label: String(i + 1),
      // Under fixed start positions the team number *is* the spawn choice — say
      // so in the picker, mirroring the multiplayer team dropdown (#456).
      description:
        startPosType === 0 ? `Spawns at map position ${i + 1}` : undefined,
      icon: (
        <span
          aria-hidden
          className={cn(
            "size-3 shrink-0 rounded-sm",
            teamLeader && "border border-white/25",
          )}
          style={
            teamLeader ? { background: rgbToHex(teamLeader.color) } : undefined
          }
        />
      ),
    };
  });
  // A game with one faction, or one whose sides are not known, has no faction
  // for anyone to pick, so the column goes rather than showing a picker with
  // nothing in it.
  const showFaction = showsFactionColumn(sides);
  // Hardest first within each group, with AIs no ranking places last, so the
  // pips read as an ordered scale rather than scattered through the list.
  const sorted = orderedAis(ais, aiConfig);
  const nativeAis = sorted.filter((a) => a.kind === "native");
  const luaAis = sorted.filter((a) => a.kind === "lua");
  const pipsFor = (a: SkirmishAi) => {
    // A chicken AI is left out of the ranking on purpose, so its level comes
    // out of its name instead. See `minigamePips`.
    const filled =
      aiPips(a, ais, aiConfig) ?? minigamePips(a.name ?? a.shortName);
    return filled === undefined ? undefined : (
      <DifficultyPips filled={filled} />
    );
  };

  // Defensive flag (#501): a row whose selected AI isn't in this game's list at
  // all reads as invalid rather than being shown as a normal (blank) pick. Only
  // meaningful once the list has loaded, so an empty list never flags anything.
  const aiInvalid = (p: Participant): boolean =>
    p.kind === "ai" &&
    !!p.ai &&
    ais.length > 0 &&
    !ais.some(
      (a) => a.shortName.toLowerCase() === p.ai?.shortName.toLowerCase(),
    );

  return (
    <div className="rounded-lg border border-border/50 bg-card">
      <Table className="border-collapse">
        <TableHeader>
          <TableRow className="text-[11px] uppercase tracking-wide text-muted-foreground border-border/40 hover:bg-transparent">
            <TableHead className="w-full px-3 pb-2 pt-3 text-left font-medium text-muted-foreground">
              Player
            </TableHead>
            {showFaction && (
              <TableHead className="px-2 pb-2 pt-3 text-left font-medium text-muted-foreground">
                Faction
              </TableHead>
            )}
            <TableHead className="px-2 pb-2 pt-3 text-left font-medium text-muted-foreground">
              Team
            </TableHead>
            <TableHead className="px-2 pb-2 pt-3 text-left font-medium text-muted-foreground">
              Ally
            </TableHead>
            <TableHead className="pb-2 pl-1 pr-2 pt-3" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayOrder.map((p) => {
            const teamIdx = teamIndexById.get(p.id);
            const leader = leaderOf(p);
            // A non-leader row sharing a team: its team-level controls (colour,
            // side, ally) are hidden — the leader's row above carries them.
            const sharer = teamIdx !== undefined && leader.id !== p.id;
            const sharedTitle = sharer
              ? `Shares a team with ${leader.name} — team settings come from the first member`
              : undefined;
            return (
              <TableRow
                key={p.id}
                className="border-border/40 hover:bg-transparent"
              >
                <TableCell className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    {sharer ? (
                      // A file-explorer-style branch in the team colour, marking
                      // this row as a member of the leader's team above it.
                      <span
                        aria-hidden
                        title={sharedTitle}
                        className="flex size-6 shrink-0 items-start justify-center"
                      >
                        <span
                          className="h-4 w-3 translate-x-1.5 rounded-bl-md border-b-2 border-l-2"
                          style={{ borderColor: rgbToHex(leader.color) }}
                        />
                      </span>
                    ) : (
                      <input
                        type="color"
                        aria-label={`${p.name} colour`}
                        value={rgbToHex(p.color)}
                        disabled={disabled}
                        onChange={(e) =>
                          onUpdate(p.id, { color: hexToRgb(e.target.value) })
                        }
                        className="color-swatch size-6 shrink-0 cursor-pointer rounded border border-white/25 bg-transparent p-0 disabled:cursor-not-allowed"
                      />
                    )}
                    {p.kind === "you" ? (
                      <div className="leading-tight">
                        <div>You</div>
                        <div className="text-[11px] text-muted-foreground">
                          Human · host
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1 leading-tight">
                        <Select
                          value={p.ai ? aiValue(p.ai) : ""}
                          disabled={disabled}
                          onValueChange={(v) => {
                            const [kind, shortName] = v.split(/:(.*)/s);
                            const found = ais.find(
                              (a) =>
                                a.kind === kind && a.shortName === shortName,
                            );
                            onUpdate(p.id, {
                              ai: {
                                kind: kind as "native" | "lua",
                                shortName,
                                name: found?.name,
                              },
                            });
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            className="w-full"
                            aria-invalid={!p.ai}
                          >
                            <SelectValue placeholder="Pick an AI" />
                          </SelectTrigger>
                          <SelectContent>
                            {nativeAis.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Engine AIs</SelectLabel>
                                {nativeAis.map((a) => (
                                  <SelectItem
                                    key={aiValue(a)}
                                    value={aiValue(a)}
                                    description={aiByline(a)}
                                    trailing={pipsFor(a)}
                                  >
                                    {aiLabel(a)}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {luaAis.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Game AIs (Lua)</SelectLabel>
                                {luaAis.map((a) => (
                                  <SelectItem
                                    key={aiValue(a)}
                                    value={aiValue(a)}
                                    description={aiByline(a)}
                                    trailing={pipsFor(a)}
                                  >
                                    {aiLabel(a)}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {ais.length === 0 && (
                              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                No AIs found
                              </div>
                            )}
                          </SelectContent>
                        </Select>
                        {aiInvalid(p) && (
                          <span className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="size-3.5 shrink-0" />
                            {p.ai?.shortName} isn't available in this game
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </TableCell>

                {showFaction && (
                  <TableCell className="px-2 py-2">
                    {p.kind === "you" && p.spectator ? (
                      <span className="text-xs text-muted-foreground">–</span>
                    ) : sharer ? (
                      <Badge
                        variant="outline"
                        title={sharedTitle}
                        style={{
                          color: rgbToHex(leader.color),
                          borderColor: rgbToHex(leader.color),
                        }}
                      >
                        Co-player
                      </Badge>
                    ) : (
                      <OptionSelect
                        value={p.side}
                        size="sm"
                        className="w-auto min-w-20"
                        disabled={disabled || sides.length === 0}
                        options={sideOptions}
                        onValueChange={(v) => onUpdate(p.id, { side: v })}
                      />
                    )}
                  </TableCell>
                )}

                <TableCell className="px-2 py-2">
                  {teamIdx === undefined ? (
                    <span className="text-xs text-muted-foreground">–</span>
                  ) : (
                    <Select
                      value={String(teamIdx)}
                      disabled={disabled}
                      onValueChange={(v) => onSetTeam(p.id, Number(v))}
                    >
                      <SelectTrigger size="sm" className="w-16">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {teamOptions.map((o) => (
                          <SelectItem
                            key={o.value}
                            value={o.value}
                            description={o.description}
                            icon={o.icon}
                          >
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>

                <TableCell className="px-2 py-2">
                  {p.kind === "you" && p.spectator ? (
                    <span className="text-xs text-muted-foreground">–</span>
                  ) : sharer ? null : (
                    <OptionSelect
                      value={String(p.allyTeam)}
                      size="sm"
                      className="w-24"
                      disabled={disabled}
                      options={allyOptions}
                      onValueChange={(v) =>
                        onUpdate(p.id, { allyTeam: Number(v) })
                      }
                    />
                  )}
                </TableCell>

                <TableCell className="py-2 pl-1 pr-2 text-right">
                  {p.kind === "you" ? null : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Remove ${p.name}`}
                      disabled={disabled}
                      onClick={() => onRemove(p.id)}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {startPosType === 0 && (
        <div className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
          Fixed start positions: team N spawns at the map's start position N.
          {startPosCount !== undefined &&
            startPosCount < leaderIdByTeam.length &&
            ` This map only defines ${startPosCount} start position${
              startPosCount === 1 ? "" : "s"
            }; extra teams get engine-picked spots.`}
        </div>
      )}

      <div className="border-t border-border/40 p-3">
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onAddAi}>
          + Add AI opponent
        </Button>
      </div>
    </div>
  );
}
