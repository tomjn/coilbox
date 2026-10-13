-- Coilbox rewind player: stand-in until the real player gadget replaces it
-- (issue #3794).
--
-- Coilbox generates a game that depends on the game a replay was recorded on
-- and puts the replay's track in it at coilbox_rewind/track.cbtrack. This
-- gadget only proves that the track reached the game. It loads the reader,
-- opens the track and logs one line with the track's frame range and counts,
-- or the reason it could not. It creates nothing and moves nothing.
--
-- The real player takes this file's name and place, so the generated game does
-- not change when it arrives. Change it in the coilbox repository under
-- lua/rewind-player/.

function gadget:GetInfo()
	return {
		name = "Coilbox rewind player",
		desc = "Plays a replay track back. For now it logs the track's header.",
		author = "coilbox",
		date = "2026",
		license = "MIT",
		layer = 0,
		enabled = true,
	}
end

if not gadgetHandler:IsSyncedCode() then
	return false
end

local PREFIX = "COILBOX_REWIND_PLAYER "

function gadget:Initialize()
	local Track = VFS.Include("luarules/rewind_player/coilbox_track.lua")
	local Fetch = VFS.Include("luarules/rewind_player/coilbox_track_fetch.lua")

	local fetch, why = Fetch.fromVFS()
	if not fetch then
		Spring.Echo(PREFIX .. "failed: " .. tostring(why))
		return
	end
	local track, openWhy = Track.open(fetch)
	if not track then
		Spring.Echo(PREFIX .. "failed: " .. tostring(openWhy))
		return
	end
	local info, infoWhy = track:info()
	if not info then
		Spring.Echo(PREFIX .. "failed: " .. tostring(infoWhy))
		return
	end
	local features, featuresWhy = track:features()
	if not features then
		Spring.Echo(PREFIX .. "failed: " .. tostring(featuresWhy))
		return
	end
	local h = track.header
	Spring.Echo(
		string.format(
			"%strack frames %d to %d, windows %d, window length %d, unit defs %d, teams %d, features %d, game %s, map %s",
			PREFIX,
			h.firstFrame,
			h.lastFrame,
			h.windowCount,
			h.windowLength,
			#info.unitDefs,
			#info.teams,
			#features,
			info.game,
			info.map
		)
	)
end
