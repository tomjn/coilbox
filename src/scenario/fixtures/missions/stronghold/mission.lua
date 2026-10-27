-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 10,
  id = "stronghold",
  name = "Stronghold",
  description = "A walled enemy compound that stands from the first frame, and an outpost on a raised pad that a trigger places a minute in. Proves a base's terrain changes are set before its buildings, at the start and from a trigger.",
  game = "Test Game",
  map = "Comet Catcher Redux",
  teams = {
    defenders = { team = 1, noCommander = true },
    player = { team = 0 },
  },
  zones = {},
  actors = {},
  groups = {},
  prefabs = {
    {
      id = "compound",
      team = "defenders",
      origin = { x = 2400, z = 2400 },
      terrain = {
        {
          kind = "raise",
          shape = "wall",
          points = {
            { x = -192, z = -192 },
            { x = 192, z = -192 },
            { x = 192, z = 192 },
            { x = -192, z = 192 },
            { x = -192, z = -192 },
          },
          height = 48,
        },
        {
          kind = "level",
          shape = "area",
          points = {
            { x = -96, z = -96 },
            { x = 96, z = -96 },
            { x = 96, z = 96 },
            { x = -96, z = 96 },
          },
          height = 0,
        },
      },
      buildings = {
        {
          def = "corlab",
          offset = { x = 0, z = 0 },
          facing = 2,
        },
        {
          def = "corllt",
          offset = { x = 128, z = 128 },
          facing = 0,
        },
      },
    },
    {
      id = "outpost",
      team = "defenders",
      origin = { x = 1600, z = 2400 },
      dormant = true,
      terrain = {
        {
          kind = "raise",
          shape = "area",
          points = {
            { x = -64, z = -64 },
            { x = 64, z = -64 },
            { x = 64, z = 64 },
            { x = -64, z = 64 },
          },
          height = 32,
        },
        {
          kind = "ramp",
          shape = "wall",
          points = {
            { x = 0, z = 200 },
            { x = 0, z = 72 },
          },
          heights = { 0, 32 },
          width = 64,
        },
      },
      buildings = {
        {
          def = "corllt",
          offset = { x = 0, z = 0 },
          facing = 0,
        },
      },
    },
  },
  restrictions = {},
  vars = {},
  triggers = {
    {
      id = "reinforce",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "time_elapsed",
            params = { seconds = 60 },
          },
        },
      },
      actions = {
        {
          type = "spawn_base",
          params = { base = "outpost" },
        },
      },
    },
  },
  objectives = {},
  dialogue = {},
}
