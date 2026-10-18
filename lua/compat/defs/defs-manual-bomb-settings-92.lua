-- id: defs-manual-bomb-settings-92
-- catalogue: defTag:WeaponDefs.manualBombSettings
-- defs: weapondefs_post
-- license: MIT or GNU GPL, v2 or later

-- The burst of a bomb, worked out as engines before 92.0 did.
--
-- Changelog, 92.0: "remove of manualBombSettings (backward-compatibility code
-- in weapondefs_post.lua)". Up to 91.0, WeaponDefHandler.cpp gave every
-- AircraftBomb weapon a burst of its own unless the def set manualBombSettings
-- to true, which kept the def's burst and burstRate:
--
-- - with a reloadTime under 0.5, a burstRate of the reload time or 0.2,
--   whichever is less, a burst of one more than a second divided by that rate,
--   and a reloadTime of 5;
-- - otherwise, a burstRate of the reload time or 0.4, whichever is less, and
--   a burst of 2.
--
-- It worked in 32 bit floats, so a reload time of 0.142857 gave a burst of 7,
-- where the same sums in Lua's 64 bit numbers give 8. This rounds each step to
-- 32 bits as the engine did.
--
-- The engine's own gamedata/weapondefs_post.lua took the job over in 92.0 with
-- the test the wrong way round: it works out the burst only for a weapon that
-- sets manualBombSettings. So this runs in the mutator's weapondefs_post.lua,
-- in front of the engine's copy, and takes manualBombSettings off every bomb
-- once it has read it. The engine's copy then leaves every bomb as this left
-- it. A game that ships its own weapondefs_post.lua covers up the mutator's, so
-- the mutator writes none and this does not run.
--
-- A bomb is a def whose weaponType is AircraftBomb, or one with no weaponType
-- that sets dropped, which the engine's copy then makes an AircraftBomb. A
-- reload time of 0 or less, which gave the old engine no burst it could count,
-- is left as it is.

local compat = ...

local TWO_24 = 16777216

-- x rounded to the nearest 32 bit float, ties to even.
local function f32(x)
	if x == 0 or x ~= x or x == math.huge or x == -math.huge then
		return x
	end
	local m, e = math.frexp(x)
	m = m * TWO_24
	local r = math.floor(m + 0.5)
	if r - m == 0.5 and r % 2 == 1 then
		r = r - 1
	end
	return math.ldexp(r / TWO_24, e)
end

local function isBomb(wd)
	local kind = compat.get(wd, "weapontype")
	if kind ~= nil then
		return type(kind) == "string" and kind:lower() == "aircraftbomb"
	end
	return compat.bool(compat.get(wd, "dropped"))
end

for _, wd in ipairs(compat.weapons()) do
	if isBomb(wd) then
		local key = compat.key(wd, "manualbombsettings")
		local manual = key ~= nil and compat.bool(wd[key])
		if key ~= nil then
			wd[key] = nil
			compat.changed[wd] = true
		end
		local reload = f32(tonumber(compat.get(wd, "reloadtime")) or 1)
		if not manual and reload > 0 then
			local rate, burst
			if reload < 0.5 then
				rate = math.min(f32(0.2), reload)
				burst = math.floor(f32(1 / rate)) + 1
				compat.set(wd, "reloadtime", 5)
			else
				rate = math.min(f32(0.4), reload)
				burst = 2
			end
			compat.set(wd, "burstrate", rate)
			compat.set(wd, "burst", burst)
		end
	end
end
