-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 1,
  id = "98794cb1-b697-4b7e-a739-f565a5008b85",
  name = "Silence the Jericho",
  description = "A Federation of Kala strike team lands light, scouts the ridge and destroys the Loz Jericho battery shelling the Kala line.",
  game = "SplinterFaction $VERSION",
  map = "AcidicQuarry 5.17",
  teams = {
    p2 = { team = 0 },
    p3 = { team = 1 },
  },
  zones = {
    {
      id = "726d190f-bf59-4338-944c-76c59ef4970d",
      name = "Ridge",
      shape = "box",
      min = { x = 2083, z = 2713 },
      max = { x = 3642, z = 3655 },
    },
    {
      id = "bc8354ff-31cc-44a0-84dc-d561a5878934",
      name = "Outpost yard",
      shape = "circle",
      center = { x = 4932, z = 1771 },
      radius = 259,
    },
    {
      id = "dd6c16ee-6c2b-4156-9889-cf642fbf71d5",
      name = "Battery yard",
      shape = "circle",
      center = { x = 4706, z = 1714 },
      radius = 451,
    },
    {
      id = "67fe2e6b-fc7a-458d-a00e-e87622539622",
      name = "Perimeter",
      shape = "box",
      min = { x = 4489, z = 372 },
      max = { x = 5652, z = 2967 },
    },
  },
  actors = {
    {
      id = "6e0f3ff8-b197-4c06-8e4d-4fb2af72b0d6",
      unitDef = "lozjericho",
      team = "p3",
      pos = { x = 5025, z = 1496 },
      facing = 0,
      state = { name = "Jericho Battery" },
    },
    {
      id = "cb5fea04-61a1-4d06-a33b-5bdc1964498a",
      unitDef = "lozmetalextractor",
      team = "p3",
      pos = { x = 5253, z = 1704 },
      facing = 0,
      state = { name = "Outpost Extractor" },
    },
  },
  groups = {
    {
      id = "43e9c94f-2832-4fad-9e35-ec4aa6d4f209",
      team = "p2",
      units = {
        { def = "fedak", count = 3 },
        { def = "fedengineer", count = 1 },
      },
      pos = { x = 1266, z = 5016 },
      orders = {},
      dormant = false,
    },
    {
      id = "ce896767-3a53-457b-9419-12903814114e",
      team = "p3",
      units = {
        { def = "lozflea", count = 2 },
      },
      pos = { x = 2802, z = 3158 },
      orders = {
        {
          kind = "patrol",
          waypoints = {
            { x = 2216, z = 3443 },
            { x = 3409, z = 2849 },
          },
        },
      },
      dormant = true,
    },
    {
      id = "db77e1ba-c0a6-4aab-b65b-c715710a954a",
      team = "p3",
      units = {
        { def = "lozscorpion", count = 2 },
      },
      pos = { x = 5054, z = 1786 },
      orders = {
        {
          kind = "patrol",
          waypoints = {
            { x = 4684, z = 1538 },
            { x = 5550, z = 1644 },
          },
        },
      },
      dormant = true,
    },
    {
      id = "9b4dd1b5-26e4-4843-a941-6392bd7df014",
      team = "p3",
      units = {
        { def = "lozroach", count = 3 },
      },
      pos = { x = 5037, z = 1106 },
      orders = {
        {
          kind = "fight",
          waypoints = {
            { x = 4243, z = 1825 },
            { x = 3332, z = 2877 },
          },
        },
      },
      dormant = true,
    },
  },
  prefabs = {
    {
      id = "4f1ab454-06d3-4c98-b63c-7f578ccf241e",
      team = "p3",
      origin = { x = 4820, z = 1303 },
      buildings = {
        {
          def = "f2landfac",
          offset = { x = 0, z = 0 },
          facing = 0,
          queue = { "lozroach", "lozscorpion" },
        },
        {
          def = "fusionpowerplant",
          offset = { x = 427, z = -44 },
          facing = 0,
        },
        {
          def = "lozrazor",
          offset = { x = 607, z = 185 },
          facing = 0,
        },
        {
          def = "mediumstorage",
          offset = { x = 150, z = 523 },
          facing = 0,
        },
        {
          def = "lozrazor",
          offset = { x = -144, z = 346 },
          facing = 0,
        },
      },
    },
  },
  restrictions = {
    buildable = {
      mode = "allow",
      units = {
        "fedmetalextractor",
        "fedstinger",
        "lozroach",
        "lozscorpion",
      },
    },
    commands = { "selfd" },
  },
  vars = { alerted = 0 },
  triggers = {
    {
      id = "deploy",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {},
      },
      actions = {
        {
          type = "dialogue",
          params = { line = "brief-light" },
        },
        {
          type = "map_marker",
          params = {
            pos = { x = 4679, z = 1726 },
            text = "Jericho battery",
          },
        },
        {
          type = "spawn_group",
          params = { group = "ce896767-3a53-457b-9419-12903814114e" },
        },
        {
          type = "dialogue",
          params = { line = "brief-target" },
        },
        {
          type = "spawn_group",
          params = { group = "db77e1ba-c0a6-4aab-b65b-c715710a954a" },
        },
      },
    },
    {
      id = "ridge-contact",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "units_in_zone",
            params = {
              min = 1,
              team = "p2",
              zone = "726d190f-bf59-4338-944c-76c59ef4970d",
            },
          },
        },
      },
      actions = {
        {
          type = "dialogue",
          params = { line = "ridge-contact" },
        },
        {
          type = "wake_group",
          params = { group = "ce896767-3a53-457b-9419-12903814114e" },
        },
        {
          type = "complete_objective",
          params = { objective = "scout-ridge" },
        },
        {
          type = "enable_trigger",
          params = { trigger = "alarm" },
        },
      },
    },
    {
      id = "alarm",
      enabled = false,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "units_in_zone",
            params = {
              min = 1,
              team = "p2",
              zone = "67fe2e6b-fc7a-458d-a00e-e87622539622",
            },
          },
        },
      },
      actions = {
        {
          type = "dialogue",
          params = { line = "alarm" },
        },
        {
          type = "wake_group",
          params = { group = "db77e1ba-c0a6-4aab-b65b-c715710a954a" },
        },
        {
          type = "set_var",
          params = { name = "alerted", value = 1 },
        },
        {
          type = "reveal_area",
          params = {
            seconds = 30,
            team = "p2",
            zone = "bc8354ff-31cc-44a0-84dc-d561a5878934",
          },
        },
      },
    },
    {
      id = "scramble-reserve",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "zone_held_for",
            params = {
              seconds = 10,
              team = "p2",
              zone = "dd6c16ee-6c2b-4156-9889-cf642fbf71d5",
            },
          },
          {
            type = "var",
            params = { name = "alerted", op = "eq", value = 1 },
          },
        },
      },
      actions = {
        {
          type = "dialogue",
          params = { line = "scramble" },
        },
        {
          type = "wake_group",
          params = { group = "9b4dd1b5-26e4-4843-a941-6392bd7df014" },
        },
      },
    },
    {
      id = "extractor-down",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_dead",
            params = { actor = "cb5fea04-61a1-4d06-a33b-5bdc1964498a" },
          },
        },
      },
      actions = {
        {
          type = "dialogue",
          params = { line = "supply-cut" },
        },
        {
          type = "complete_objective",
          params = { objective = "cut-supply" },
        },
      },
    },
    {
      id = "battery-down",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_dead",
            params = { actor = "6e0f3ff8-b197-4c06-8e4d-4fb2af72b0d6" },
          },
        },
      },
      actions = {
        {
          type = "dialogue",
          params = { line = "battery-down" },
        },
        {
          type = "complete_objective",
          params = { objective = "silence-battery" },
        },
        {
          type = "victory",
          params = { team = "p2" },
        },
      },
    },
    {
      id = "strike-team-lost",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_count",
            params = { max = 0, team = "p2" },
          },
          {
            type = "time_elapsed",
            params = { seconds = 30 },
          },
        },
      },
      actions = {
        {
          type = "dialogue",
          params = { line = "team-lost" },
        },
        {
          type = "fail_objective",
          params = { objective = "silence-battery" },
        },
        {
          type = "defeat",
          params = { team = "p2" },
        },
      },
    },
  },
  objectives = {
    {
      id = "silence-battery",
      kind = "primary",
      text = "Destroy the Loz Jericho battery.",
      hidden = false,
    },
    {
      id = "scout-ridge",
      kind = "secondary",
      text = "Scout the ridge before you commit to the assault.",
      hidden = false,
    },
    {
      id = "cut-supply",
      kind = "secondary",
      text = "Cut the outpost's supply: destroy its metal extractor.",
      hidden = false,
    },
  },
  dialogue = {
    {
      id = "brief-light",
      speaker = "Kala Command",
      text = "Strike team, you are down light: three A.K.s and one Lifter. There is no commander coming.",
    },
    {
      id = "brief-target",
      speaker = "Kala Command",
      text = "The Loz Jericho battery east of the ridge is shelling our line. Silence it.",
    },
    {
      id = "ridge-contact",
      speaker = "Scout Lead",
      text = "Movement on the ridge. Their patrol just woke up.",
    },
    {
      id = "alarm",
      speaker = "Loz Warden",
      text = "Federation units inside the perimeter. All units, engage.",
    },
    {
      id = "scramble",
      speaker = "Loz Warden",
      text = "They are standing in the battery yard. Scramble the reserve.",
    },
    {
      id = "supply-cut",
      speaker = "Kala Command",
      text = "Extractor down. Their repairs just got a lot slower.",
    },
    {
      id = "battery-down",
      speaker = "Kala Command",
      text = "Battery silenced. Good work, strike team. Come home.",
    },
    {
      id = "team-lost",
      speaker = "Kala Command",
      text = "Strike team is gone. Pull the line back.",
    },
  },
}
