-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 1,
  id = "splinter",
  name = "Splinter smoke",
  description = "The smallest scenario that proves the runtime on SplinterFaction: the game's own start is suppressed, the runtime places the player's squad, two build icons are greyed against a game that greys its own, and a timer ends the mission.",
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
      startUnits = { "fedengineer_up1" },
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
  restrictions = {
    buildable = {
      mode = "deny",
      units = { "supplydepot", "f1landfac" },
    },
  },
  vars = {},
  triggers = {
    {
      id = "hold-out",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "time_elapsed",
            params = { seconds = 90 },
          },
        },
      },
      actions = {
        {
          type = "complete_objective",
          params = { objective = "hold-out" },
        },
        {
          type = "victory",
          params = { team = "player" },
        },
      },
    },
  },
  objectives = {
    {
      id = "hold-out",
      kind = "primary",
      text = "Hold out for ninety seconds.",
      hidden = false,
    },
  },
  dialogue = {},
}
