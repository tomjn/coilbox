-- The mission scripts/mission-sf-extension.sh plays.
--
-- Shaped exactly like a mission coilbox compiles, but written by hand and kept
-- here rather than in src/scenario/fixtures/missions/, because the two trigger
-- types it uses are Splinter Faction's and mean nothing to any other game. The
-- fixtures are played against Balanced Annihilation by scripts/mission-headless.sh
-- and by mission_trigger_test.lua, and a fixture naming a type only one game has
-- would be dead weight in both.
--
-- Its teams are the adoption proof's, so it starts the same way: the game's own
-- start is suppressed and the runtime places one engineer a side.
return {
  schemaVersion = 1,
  runtimeVersion = 1,
  id = "extension",
  name = "Extension smoke",
  description = "Pays a team research points through the game's own ledger, and waits on the balance.",
  game = "SplinterFaction",
  map = "AcidicQuarry 5.17",
  teams = {
    enemy = {
      team = 1,
      resources = { metal = 100, energy = 100 },
      noCommander = true,
    },
    player = {
      team = 0,
      startUnits = { "fedengineer" },
      resources = { metal = 750, energy = 750 },
      noCommander = true,
    },
  },
  zones = {},
  actors = {
    {
      id = "watchpost",
      unitDef = "lozengineer",
      team = "enemy",
      pos = { x = 1400, z = 1400 },
      facing = 0,
    },
  },
  groups = {},
  prefabs = {},
  restrictions = {},
  vars = {},
  triggers = {
    -- The runtime's own time_elapsed, which the declaration also names and the
    -- runtime refuses to hand over.
    {
      id = "grant",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "time_elapsed",
            params = { seconds = 2 },
          },
        },
      },
      actions = {
        {
          type = "sf_grant_research",
          params = { team = "player", amount = 500 },
        },
      },
    },
    -- The game's own condition, waiting on a number only the game can read.
    {
      id = "funded",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "sf_research_above",
            params = { team = "player", amount = 400 },
          },
        },
      },
      actions = {
        {
          type = "complete_objective",
          params = { objective = "funded" },
        },
      },
    },
  },
  objectives = {
    {
      id = "funded",
      kind = "primary",
      text = "Get the research grant.",
      hidden = false,
    },
  },
  dialogue = {},
}
