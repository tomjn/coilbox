-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 12,
  id = "pursuit",
  name = "Pursuit",
  description = "A squad told to hunt the player, whose only units are a solar collector near it and an invulnerable one further off. Proves a group attacks a team's nearest unit, moves on when that unit dies, follows a unit that has moved, and stops ordering once the team has nothing left.",
  game = "Test Game",
  map = "Comet Catcher Redux",
  teams = {
    player = { team = 0, noCommander = true },
    raiders = { team = 1, noCommander = true },
  },
  zones = {},
  actors = {
    {
      id = "near",
      unitDef = "armsolar",
      team = "player",
      pos = { x = 1800, z = 2400 },
      facing = 0,
    },
    {
      id = "far",
      unitDef = "armsolar",
      team = "player",
      pos = { x = 1200, z = 1200 },
      facing = 0,
      state = { invulnerable = true },
    },
  },
  groups = {
    {
      id = "hunters",
      team = "raiders",
      units = {
        { def = "corak", count = 3 },
      },
      pos = { x = 2400, z = 2400 },
      orders = {
        { kind = "hunt", team = "player" },
      },
      dormant = false,
    },
  },
  prefabs = {},
  restrictions = {},
  vars = {},
  triggers = {},
  objectives = {},
  dialogue = {},
}
