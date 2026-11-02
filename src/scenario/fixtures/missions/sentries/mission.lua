-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 11,
  id = "sentries",
  name = "Sentries",
  description = "A garrison that stands in its post from the first frame and walks its patrol when a trigger wakes it ten seconds in. Proves a group can start on the map asleep.",
  game = "Test Game",
  map = "Comet Catcher Redux",
  teams = {
    defenders = { team = 1, noCommander = true },
    player = { team = 0 },
  },
  zones = {},
  actors = {},
  groups = {
    {
      id = "post",
      team = "defenders",
      units = {
        { def = "armpw", count = 2 },
      },
      pos = { x = 2400, z = 2400 },
      orders = {
        {
          kind = "patrol",
          waypoints = {
            { x = 2800, z = 2400 },
          },
        },
      },
      dormant = false,
      startsAsleep = true,
    },
  },
  prefabs = {},
  restrictions = {},
  vars = {},
  triggers = {
    {
      id = "call-out",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "time_elapsed",
            params = { seconds = 10 },
          },
        },
      },
      actions = {
        {
          type = "wake_group",
          params = { group = "post" },
        },
      },
    },
  },
  objectives = {},
  dialogue = {},
}
