-- Coilbox rewind player: the game adapter (issue #3799).
--
-- An adapter is a small file per game that says what to switch off during
-- playback and what to hide. Coilbox picks it before the launch and writes it
-- into the playback game at M.PATH. This module reads that file and gives the
-- player what it needs from it. lua/rewind-player/README.md has the format.
--
-- Two parts of an adapter are not read here. Coilbox reads `gadgets` and
-- `widgets` itself and shadows each named file with an empty one in the playback
-- game, so a switched off gadget never loads. The player only counts them, for
-- the log line.
--
-- The file is one of three things:
--   a table      the adapter
--   false        no adapter applies to the game
--   { problem }  an adapter was found and could not be used. The player plays
--                as if there were none and says why

local M = {}

--- Where the playback game holds the adapter in use. Coilbox writes it on every
-- launch, so it is there whatever the base game holds at this path.
M.PATH = "coilbox_rewind/adapter.lua"

--- The hooks the player calls, and nothing else. The log names a hook the file
-- has that is not here, since it is most likely a misspelling.
M.HOOKS = {
	-- () once, when the player has opened the track, before the first frame and
	-- so before anything of the track is in the world.
	started = true,
	-- (unitID, unitDefID, t, clock, effect) after the player created a unit and
	-- put it in place. Called again for a unit made again after a seek. `effect`
	-- is whether the player is about to show its arrival effect for the unit
	-- (issue #4009), and a hook that gives true has shown the game's own, so
	-- the player shows none.
	unitPlaced = true,
	-- (t, clock) after every stage has put the world in place on a frame.
	afterFrame = true,
}

local LISTS = { "gadgets", "widgets", "units", "features", "teamParams", "gameParams" }

--- A copy of a list of names, which are case sensitive and kept as they are.
local function copied(list)
	local copy = {}
	for i = 1, #(list or {}) do
		copy[i] = list[i]
	end
	return copy
end

--- The adapter's lists as sets of lowercase names, because the engine's names
-- for definitions and files are not case sensitive.
local function lowerSet(list)
	local set = {}
	for i = 1, #list do
		set[list[i]:lower()] = true
	end
	return set
end

--- What `raw`, the value the adapter file returned, makes. Gives the adapter,
-- or nil when there is none, and then a reason when the file was not usable.
function M.normalize(raw)
	if raw == nil or raw == false then
		return nil
	end
	if type(raw) ~= "table" then
		return nil, "the adapter file returned a " .. type(raw) .. " and not a table"
	end
	if raw.problem ~= nil then
		return nil, tostring(raw.problem)
	end
	for _, key in ipairs(LISTS) do
		local list = raw[key]
		if list ~= nil then
			if type(list) ~= "table" then
				return nil, "the adapter's " .. key .. " is not a list of names"
			end
			for i = 1, #list do
				if type(list[i]) ~= "string" then
					return nil, "the adapter's " .. key .. " has something at place " .. i .. " that is not a name"
				end
			end
		end
	end
	if raw.hooks ~= nil and type(raw.hooks) ~= "table" then
		return nil, "the adapter's hooks is not a table"
	end

	local adapter = {
		name = type(raw.name) == "string" and raw.name or "unnamed",
		gadgetCount = raw.gadgets and #raw.gadgets or 0,
		widgetCount = raw.widgets and #raw.widgets or 0,
		hiddenUnits = lowerSet(raw.units or {}),
		hiddenUnitCount = raw.units and #raw.units or 0,
		skippedFeatures = lowerSet(raw.features or {}),
		skippedFeatureCount = raw.features and #raw.features or 0,
		-- The rules parameters that are the recording's to set (issue #3982).
		-- Coilbox reads the same two lists to tell the recorder what to record.
		teamParams = copied(raw.teamParams),
		gameParams = copied(raw.gameParams),
		hooks = {},
		hookNames = {},
		unknownHooks = {},
	}
	for name, hook in pairs(raw.hooks or {}) do
		if M.HOOKS[name] and type(hook) == "function" then
			adapter.hooks[name] = hook
			adapter.hookNames[#adapter.hookNames + 1] = name
		else
			adapter.unknownHooks[#adapter.unknownHooks + 1] = tostring(name)
		end
	end
	table.sort(adapter.hookNames)
	table.sort(adapter.unknownHooks)
	return adapter
end

--- Reads the adapter the playback game holds. Gives the adapter, or nil when
-- there is none and then the reason if there was a file that could not be used.
function M.load(vfs)
	if not vfs.FileExists(M.PATH) then
		return nil
	end
	-- Include runs the file in the environment of the function that calls it. A
	-- Lua function around it keeps that this module's, which is the gadget's, and
	-- pcall itself would hand the file the global one.
	local ok, raw = pcall(function()
		return vfs.Include(M.PATH)
	end)
	if not ok then
		return nil, "the adapter file raised: " .. tostring(raw)
	end
	return M.normalize(raw)
end

--- The log line that says which adapter the player has, without its prefix.
function M.describe(adapter, why)
	if not adapter then
		return "adapter loaded: none" .. (why and (". " .. why) or "")
	end
	local hooks = #adapter.hookNames > 0 and table.concat(adapter.hookNames, ", ") or "none"
	return string.format(
		"adapter loaded: %s. %d gadgets and %d widgets are switched off by the playback game, %d unit definitions are hidden, %d feature definitions are skipped, hooks: %s",
		adapter.name,
		adapter.gadgetCount,
		adapter.widgetCount,
		adapter.hiddenUnitCount,
		adapter.skippedFeatureCount,
		hooks
	)
end

--- A hook of the adapter that cannot take the player down. A hook that raises is
-- reported once and not called again. Gives nil when the adapter has no such
-- hook, so a caller can test for it once and not on every frame. What the hook
-- gives back is handed on, and a hook that raised gives nothing.
function M.guarded(adapter, name, report)
	local hook = adapter and adapter.hooks[name]
	if not hook then
		return nil
	end
	local broken = false
	return function(a, b, c, d, e)
		if broken then
			return
		end
		local ok, err = pcall(hook, a, b, c, d, e)
		if ok then
			return err
		end
		broken = true
		report("hook " .. name, "the adapter's " .. name .. " hook raised and is switched off for the rest of the run: " .. tostring(err))
	end
end

return M
