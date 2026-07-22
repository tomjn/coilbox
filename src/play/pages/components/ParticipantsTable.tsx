import { Button } from "@picoframe/frame";
import { Dices, X } from "lucide-react";
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
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import {
  aiByline,
  effectiveTeams,
  hexToRgb,
  type Participant,
  RANDOM_SIDE,
  rgbToHex,
} from "../../config";

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
  const teamOptions = Array.from({ length: activeCount }, (_, i) => ({
    value: String(i),
    label: String(i + 1),
  }));
  const nativeAis = ais.filter((a) => a.kind === "native");
  const luaAis = ais.filter((a) => a.kind === "lua");

  return (
    <div className="rounded-lg border border-border/50 bg-card">
      <Table className="border-collapse">
        <TableHeader>
          <TableRow className="text-[11px] uppercase tracking-wide text-muted-foreground border-border/40 hover:bg-transparent">
            <TableHead className="w-full px-3 pb-2 pt-3 text-left font-medium text-muted-foreground">
              Player
            </TableHead>
            <TableHead className="px-3 pb-2 pt-3 text-left font-medium text-muted-foreground">
              Faction
            </TableHead>
            <TableHead className="px-3 pb-2 pt-3 text-left font-medium text-muted-foreground">
              Team
            </TableHead>
            <TableHead className="px-3 pb-2 pt-3 text-left font-medium text-muted-foreground">
              Ally
            </TableHead>
            <TableHead className="px-3 pb-2 pt-3" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {participants.map((p) => {
            const teamIdx = teamIndexById.get(p.id);
            const leader = leaderOf(p);
            // A non-leader row sharing a team: its team-level settings (colour,
            // side, ally) are the leader's, shown read-only.
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
                    <input
                      type="color"
                      aria-label={`${p.name} colour`}
                      value={rgbToHex(sharer ? leader.color : p.color)}
                      disabled={disabled || sharer}
                      title={sharedTitle}
                      onChange={(e) =>
                        onUpdate(p.id, { color: hexToRgb(e.target.value) })
                      }
                      className="color-swatch size-6 shrink-0 cursor-pointer rounded border border-white/25 bg-transparent p-0 disabled:cursor-not-allowed"
                    />
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
                      </div>
                    )}
                  </div>
                </TableCell>

                <TableCell className="px-3 py-2">
                  {p.kind === "you" && p.spectator ? (
                    <span className="text-xs text-muted-foreground">–</span>
                  ) : (
                    <span title={sharedTitle}>
                      <OptionSelect
                        value={sharer ? leader.side : p.side}
                        size="sm"
                        className="w-auto min-w-20"
                        disabled={disabled || sharer || sides.length === 0}
                        options={sideOptions}
                        onValueChange={(v) => onUpdate(p.id, { side: v })}
                      />
                    </span>
                  )}
                </TableCell>

                <TableCell className="px-3 py-2">
                  {teamIdx === undefined ? (
                    <span className="text-xs text-muted-foreground">–</span>
                  ) : (
                    <OptionSelect
                      value={String(teamIdx)}
                      size="sm"
                      className="w-16"
                      disabled={disabled}
                      options={teamOptions}
                      onValueChange={(v) => onSetTeam(p.id, Number(v))}
                    />
                  )}
                </TableCell>

                <TableCell className="px-3 py-2">
                  {p.kind === "you" && p.spectator ? (
                    <span className="text-xs text-muted-foreground">–</span>
                  ) : (
                    <span title={sharedTitle}>
                      <OptionSelect
                        value={String(sharer ? leader.allyTeam : p.allyTeam)}
                        size="sm"
                        className="w-24"
                        disabled={disabled || sharer}
                        options={allyOptions}
                        onValueChange={(v) =>
                          onUpdate(p.id, { allyTeam: Number(v) })
                        }
                      />
                    </span>
                  )}
                </TableCell>

                <TableCell className="px-3 py-2 text-right">
                  {p.kind === "you" ? null : (
                    <Button
                      variant="ghost"
                      size="icon"
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
