/**
 * Rebuild the Splinter Faction proof mission's `teams` block through the
 * editor's own write path, and compile it (issue #899).
 *
 * The proof mission's document already carries a `teams` block, but it was typed
 * into the fixture by hand: until now nothing in the editor could write one, so
 * the block the proof plays was never the block an author would have produced.
 * This starts from the same document with `teams` emptied to `{}`, which is what
 * `newScenario` mints, replays the clicks the start conditions section makes,
 * and compiles the result.
 *
 * Byte-identity with the checked-in `mission.lua` is the point. It is what makes
 * `scripts/mission-sf-authored.sh` able to say that the run the engine does is a
 * run of what the editor writes.
 *
 * Usage: bun run scripts/sf-proof/authored-teams.ts <out.lua>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScenario } from "../../src/scenario/compile";
import { parseScenario, type Scenario } from "../../src/scenario/model";
import {
  addStartUnit,
  setTeamAmount,
  setTeamNoCommander,
} from "../../src/scenario/pages/components/teams";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = join(ROOT, "src/scenario/fixtures/splinter.json");

const out = process.argv[2];
if (!out) {
  console.error("usage: bun run scripts/sf-proof/authored-teams.ts <out.lua>");
  process.exit(2);
}

const raw = JSON.parse(readFileSync(FIXTURE, "utf8"));
// The document as a fresh scenario carries it, before an author has set a start.
raw.teams = {};
const blank = parseScenario(raw);
if (!blank) {
  console.error(`${FIXTURE} does not parse as a scenario`);
  process.exit(2);
}
if (Object.keys(blank.teams).length !== 0) {
  console.error("the starting document already has a teams block");
  process.exit(2);
}

/** The clicks the start conditions section makes, in the order it makes them. */
function author(scenario: Scenario): Scenario {
  let s = scenario;
  // The player: one engineer on the start position, a bank to open on, and the
  // mission owning the start so the game spawns no commander.
  s = addStartUnit(s, "player", "fedengineer");
  s = setTeamAmount(s, "player", "resources", "metal", 750);
  s = setTeamAmount(s, "player", "resources", "energy", 750);
  s = setTeamNoCommander(s, "player", true);
  // The enemy: no start units, a poorer bank, and its start owned too, which is
  // what makes suppressesEveryStart() true and keeps the game's pre-game phases
  // out of the mission.
  s = setTeamAmount(s, "enemy", "resources", "metal", 100);
  s = setTeamAmount(s, "enemy", "resources", "energy", 100);
  s = setTeamNoCommander(s, "enemy", true);
  return s;
}

const authored = author(blank);
console.log(`the teams block the editor wrote:`);
console.log(JSON.stringify(authored.teams, null, 2));
writeFileSync(out, compileScenario(authored));
