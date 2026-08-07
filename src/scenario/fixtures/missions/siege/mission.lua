-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 3,
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
      min = { x = 1800, z = 1800 },
      max = { x = 2200, z = 2200 },
    },
    {
      id = "yard",
      name = "Yard",
      shape = "box",
      min = { x = 2600, z = 1800 },
      max = { x = 2800, z = 2000 },
    },
  },
  actors = {
    {
      id = "warlord",
      unitDef = "corcom",
      team = "defenders",
      pos = { x = 2000, z = 2000 },
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
      pos = { x = 2000, z = 2120 },
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
      origin = { x = 1900, z = 1900 },
      buildings = {
        {
          id = "keep-lab",
          def = "corlab",
          offset = { x = 0, z = 0 },
          facing = 2,
          queue = { "corak", "corak", "corthud" },
          ["repeat"] = true,
        },
        {
          id = "keep-mex",
          def = "cormex",
          offset = { x = 128, z = 0 },
          facing = 0,
        },
      },
    },
  },
  restrictions = {
    buildable = {
      mode = "deny",
      units = { "corthud", "armllt" },
    },
    commands = { "attack" },
  },
  vars = { labDown = 0, yardHeld = 0 },
  triggers = {
    {
      id = "yard-cleared",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "zone_held_for",
            params = {
              seconds = 10,
              team = "player",
              uncontested = true,
              zone = "yard",
            },
          },
        },
      },
      actions = {
        {
          type = "set_var",
          params = { name = "yardHeld", value = 1 },
        },
      },
    },
    {
      id = "lab-down",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_dead",
            params = { actor = "keep-lab" },
          },
        },
      },
      actions = {
        {
          type = "set_var",
          params = { name = "labDown", value = 1 },
        },
      },
    },
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
