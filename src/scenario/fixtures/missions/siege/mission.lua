-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 1,
  id = "siege",
  name = "Siege",
  description = "The player must hold the keep before the clock runs out.",
  game = "Test Game",
  map = "Comet Catcher Redux",
  teams = {
    defenders = { team = 1 },
    player = { team = 0 },
  },
  zones = {
    {
      id = "keep",
      name = "Keep",
      shape = "box",
      min = { x = -50, z = -50 },
      max = { x = 50, z = 50 },
    },
  },
  actors = {
    {
      id = "warlord",
      unitDef = "corcom",
      team = "defenders",
      pos = { x = 0, z = 0 },
      facing = 2,
      state = { name = "Warlord" },
    },
  },
  groups = {
    {
      id = "keep-guard",
      team = "defenders",
      units = {
        { def = "corak", count = 3 },
      },
      pos = { x = -10, z = -10 },
      orders = {
        { kind = "guard", target = "warlord" },
      },
      dormant = false,
    },
  },
  prefabs = {
    {
      id = "keep-base",
      team = "defenders",
      origin = { x = -30, z = -30 },
      buildings = {
        {
          def = "corlab",
          offset = { x = 0, z = 0 },
          facing = 2,
          queue = { "corak", "corak", "corthud" },
          ["repeat"] = true,
        },
        {
          def = "cormex",
          offset = { x = 15, z = 0 },
          facing = 0,
        },
      },
    },
  },
  restrictions = {},
  vars = {},
  triggers = {
    {
      id = "timer",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "time_elapsed",
            params = { seconds = 600 },
          },
        },
      },
      actions = {
        {
          type = "fail_objective",
          params = { objective = "take-keep" },
        },
        {
          type = "defeat",
          params = { team = "player" },
        },
      },
    },
    {
      id = "held-keep",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "zone_held_for",
            params = { seconds = 60, team = "player", zone = "keep" },
          },
        },
      },
      actions = {
        {
          type = "complete_objective",
          params = { objective = "take-keep" },
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
      id = "take-keep",
      kind = "primary",
      text = "Hold the keep for 60 seconds.",
      hidden = false,
    },
  },
  dialogue = {},
}
