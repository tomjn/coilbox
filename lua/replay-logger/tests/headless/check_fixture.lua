-- What the logger must write for each fixture in this folder. Every claim is a
-- count or a named unit, so a run that wrote nothing fails.
--
--   luajit lua/replay-logger/tests/headless/check_fixture.lua <fixture> <events.jsonl>
--
-- <fixture> is "building" or "two_gadgets". logger_test.lua holds the same claims
-- against the stub engine, and scripts/replay-logger-headless.sh against a real one.

local M = {}

local KILLED_BY_SCRIPT = -21

local function read(lines, json)
	local byKind = { replaced = {}, created = { [0] = {}, [1] = {} }, destroyed = {} }
	for _, text in ipairs(lines) do
		local line = json.decode(text)
		if line.kind == "start_unit_replaced" then
			byKind.replaced[#byKind.replaced + 1] = line
		elseif line.kind == "unit_created" and byKind.created[line.team] then
			local list = byKind.created[line.team]
			list[#list + 1] = line
		elseif line.kind == "unit_destroyed" then
			byKind.destroyed[line.unit] = line
		end
	end
	return byKind
end

local function ofTeam(replaced, team)
	local found = {}
	for _, line in ipairs(replaced) do
		if line.team == team then
			found[#found + 1] = line
		end
	end
	return found
end

-- A unit's id, or nothing when the run never made that many.
local function id(list, index)
	return list[index] and list[index].unit
end

local CLAIMS = {}

function CLAIMS.building(log, claim)
	local first, second = log.created[0], log.created[1]
	local followed = ofTeam(log.replaced, 0)
	claim("team 0 made its start building and two replacements", #first, 3)
	claim("team 0 was followed through both", #followed, 2)
	claim("the first replacement took over from the start building", followed[1] and followed[1].unit, id(first, 1))
	claim("by being the second building", followed[1] and followed[1].by, id(first, 2))
	claim("on the frame of the swap", followed[1] and followed[1].frame, 120)
	claim("the second took over from the first", followed[2] and followed[2].unit, id(first, 2))
	claim("by being the third building", followed[2] and followed[2].by, id(first, 3))
	claim("on the frame the old one went", followed[2] and followed[2].frame, 241)
	if first[1] and first[2] then
		claim("the first replacement was snapped away from the start building",
			first[1].x ~= first[2].x and first[1].z ~= first[2].z, true)
		claim("to a building of another definition", first[1].def ~= first[2].def, true)
	end
	local gone = log.destroyed[id(first, 2) or -1]
	claim("the first replacement was a start unit by the time it went", gone and gone.startUnit, true)

	claim("team 1 made its start building and one too far away", #second, 2)
	claim("team 1 was not followed", #ofTeam(log.replaced, 1), 0)
	local lost = log.destroyed[id(second, 1) or -1]
	claim("its start building went to a script", lost and lost.weapon, KILLED_BY_SCRIPT)
	claim("and was a start unit", lost and lost.startUnit, true)
end

function CLAIMS.two_gadgets(log, claim)
	local first, second = log.created[0], log.created[1]
	local followed = ofTeam(log.replaced, 0)
	-- The start unit, the spawner's unit, the upgrade, the spawner's unit, the
	-- upgrade, the spawner's unit.
	claim("team 0 made six units", #first, 6)
	claim("team 0 was followed through both upgrades", #followed, 2)
	claim("the first went from the start unit", followed[1] and followed[1].unit, id(first, 1))
	claim("to the morph gadget's unit and not the spawner's", followed[1] and followed[1].by, id(first, 3))
	claim("the second went from that unit", followed[2] and followed[2].unit, id(first, 3))
	claim("to the morph gadget's next unit, with the spawner's either side", followed[2] and followed[2].by, id(first, 5))
	claim("on the frame the old one went", followed[2] and followed[2].frame, 241)
	for _, index in ipairs({ 2, 4, 6 }) do
		claim("the spawner's unit " .. index .. " is not a start unit", first[index] and first[index].startUnit, nil)
	end

	claim("team 1 made its start unit and two more", #second, 3)
	claim("two from the gadget that destroyed the start unit are not followed", #ofTeam(log.replaced, 1), 0)
	local lost = log.destroyed[id(second, 1) or -1]
	claim("its start unit went to a script", lost and lost.weapon, KILLED_BY_SCRIPT)
end

--- Every claim as { name, actual, expected }, for a run's lines.
function M.claims(fixture, lines, json)
	local found = {}
	CLAIMS[fixture](read(lines, json), function(name, actual, expected)
		found[#found + 1] = { name = name, actual = actual, expected = expected }
	end)
	return found
end

if arg and arg[0] and arg[0]:match("check_fixture%.lua$") then
	local here = arg[0]:match("^(.*)/[^/]+$") or "."
	local json = dofile(here .. "/../../../blueprint-widget/luaui/coilbox_blueprints/json.lua")
	local lines = {}
	for line in io.lines(arg[2]) do
		lines[#lines + 1] = line
	end
	local failures = 0
	for _, claim in ipairs(M.claims(arg[1], lines, json)) do
		if claim.actual == claim.expected then
			print("  ok " .. claim.name)
		else
			failures = failures + 1
			print("  fail " .. claim.name .. ": expected " .. tostring(claim.expected) .. ", got " .. tostring(claim.actual))
		end
	end
	if failures > 0 then
		os.exit(1)
	end
end

return M
