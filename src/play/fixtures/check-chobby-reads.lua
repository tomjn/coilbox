-- Runs Chobby's own read and apply code on an optionsPresets.json.
--
-- The code under test is lines 13-226 of LuaMenu/widgets/gui_optionpresets_panel.lua
-- (refreshJSONData, applyPreset and the locals they use), loaded unchanged. Only the
-- engine and lobby it talks to are stubbed, and every call into them is printed.
--
-- Usage, from a folder holding optionsPresets.json:
--   luajit chobby-read-check.lua <panel.lua> <libs/json.lua> [without-boxes]
local panelPath, jsonPath, mode = arg[1], arg[2], arg[3]
Json = dofile(jsonPath)

local lines, n = {}, 0
for line in io.lines(panelPath) do
	n = n + 1
	if n >= 13 and n <= 226 then
		lines[#lines + 1] = line
	end
end
local chunk = assert(loadstring(table.concat(lines, "\n") .. [[

return {
	refresh = refreshJSONData,
	apply = applyPreset,
	data = function() return jsondata end,
	error = function() return errorStr end,
	configure = function(isMultiplayer, lobby, b, enabled)
		multiplayer = isMultiplayer
		battleLobby = lobby
		battle = b
		enabledOptions = enabled
		currentAITable = {}
		multiplayerModoptions = {}
	end,
}
]], "gui_optionpresets_panel.lua:13-226"))

local log = {}
local function say(...)
	log[#log + 1] = table.concat({ ... }, " ")
end
local function show(v)
	return Json.encode(v)
end

Spring = {
	Echo = function(...) say("Spring.Echo", ...) end,
	Utilities = {
		CopyTable = function(t)
			local c = {}
			for k, v in pairs(t) do c[k] = v end
			return c
		end,
	},
}
WG = {
	Delay = function(f) f() end,
	BattleRoomWindow = {
		ApplyStartBoxes = function(boxes)
			-- Chobby's own walk, from gui_battle_room_window.lua ApplyStartBoxes.
			for i, box in ipairs(boxes) do
				say("  start box", i - 1, show({ box.left, box.top, box.right, box.bottom }))
			end
		end,
	},
}

local function lobby(name)
	local l = { name = name }
	function l:SelectMap(m) say("  SelectMap", m) end
	function l:RemoveAi(k) say("  RemoveAi", k) end
	function l:AddAi(key, lib, ally, version, opts, status)
		say("  AddAi", key, "lib=" .. tostring(lib), "ally=" .. tostring(ally), "version=" .. tostring(version),
			"options=" .. show(opts), "color=" .. show(status.teamColor), "side=" .. tostring(status.side),
			"handicap=" .. tostring(status.handicap))
	end
	function l:SetModOptions(o) say("  SetModOptions", show(o)) end
	function l:SetModOptionsThrottled(o) say("  SetModOptionsThrottled", show(o)) end
	function l:SayBattle(m) say("  SayBattle", m) end
	function l:SayBattleEx(m) say("  SayBattleEx", m) end
	return l
end

local panel = chunk()
panel.refresh()
local data = panel.data()
if type(data) ~= "table" or panel.error() ~= "" then
	print("FAIL: Chobby could not read the file: " .. tostring(panel.error()))
	os.exit(1)
end
local names = {}
for name in pairs(data) do names[#names + 1] = name end
table.sort(names)
print("read ok, records: " .. table.concat(names, " | "))

local failed = false
local all = { Bots = true, Map = true, Modoptions = true, ["Start Boxes"] = true, ["Multiplayer Battle Settings"] = true }
for _, where in ipairs({ "singleplayer", "multiplayer" }) do
	for _, name in ipairs(names) do
		if mode == "without-boxes" then
			data[name]["Start Boxes"] = nil
		end
		panel.configure(where == "multiplayer", lobby(where), { bossed = true }, all)
		log = {}
		say("apply [" .. name .. "] in " .. where)
		local ok, err = pcall(panel.apply, name)
		for _, l in ipairs(log) do print(l) end
		if not ok then
			failed = true
			print("  ERROR: " .. tostring(err))
		end
	end
end
os.exit(failed and 1 or 0)
