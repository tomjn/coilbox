-- Says what the engine has loaded and created once playback is a few hundred
-- frames in, for the adapter run of issue #3799.
--
-- The ignored Rust test an_adapter_switches_things_off_in_the_engine writes this
-- file into luaui/widgets/ of the playback game it has just generated, launches
-- a headless engine on it and reads the ADAPTER_PROBE lines back out of the log.
-- It is not part of the game coilbox ships.
--
-- Every line is a measurement. The test decides what passes.

function widget:GetInfo()
	return { name = "Coilbox rewind adapter probe", layer = 1000, enabled = true, handler = true }
end

local TAG = "ADAPTER_PROBE "

-- The track frame to report at. The fixture match has units of every kind by
-- then, and the base game has had time to ask to kill a team.
local REPORT_AT = 320

local WATCHED_WIDGET = "gui_static_resourcebar.lua"

local done = false

local function say(text)
	Spring.Echo(TAG .. text)
end

function widget:GameFrame()
	local frame = Spring.GetGameRulesParam("coilbox_rewind_frame")
	if done or not frame or frame < REPORT_AT then
		return
	end
	done = true

	local loaded, watched = 0, 0
	for _, w in ipairs(widgetHandler.widgets) do
		loaded = loaded + 1
		local basename = w.whInfo and w.whInfo.basename
		if basename and basename:lower() == WATCHED_WIDGET then
			watched = 1
		end
	end
	say("widgets loaded=" .. loaded .. " " .. WATCHED_WIDGET .. "=" .. watched)

	local counts = {}
	local all = Spring.GetAllUnits()
	for i = 1, #all do
		local name = UnitDefs[Spring.GetUnitDefID(all[i])].name
		counts[name] = (counts[name] or 0) + 1
	end
	local parts = {}
	for name, count in pairs(counts) do
		parts[#parts + 1] = name .. "=" .. count
	end
	table.sort(parts)
	say("units total=" .. #all .. " " .. table.concat(parts, " "))
	say("frame=" .. frame)
	say("done")
end
