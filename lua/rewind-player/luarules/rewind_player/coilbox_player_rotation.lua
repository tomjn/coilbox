-- Coilbox rewind player: a track's rotation as the three angles the engine takes.
--
-- A track stores a unit's and a feature's rotation as a quaternion (x, y, z, w)
-- that turns front (0, 0, 1) and up (0, 1, 0) into the directions in the world
-- (docs/reference/replay-track-format.md). The engine's calls that set a whole
-- orientation on every engine version, `Spring.MoveCtrl.SetRotation` and
-- `Spring.SetFeatureRotation`, take a pitch, a yaw and a roll.
--
-- What the engine makes of those is `CSolidObject::SetDirVectorsEuler`, which
-- runs `CMatrix44f::RotateEulerXYZ` (rts/System/Matrix44f.cpp in RecoilEngine at
-- 212c369b4c): a turn about x by the pitch, then y by the yaw, then z by the
-- roll, each as that file's RotateX, RotateY and RotateZ write them. Worked
-- through, with p, y and r the three angles:
--
--   front = ( -sin y,       cos y sin p,                     cos y cos p )
--   up    = ( sin r cos y,  sin r sin y sin p + cos r cos p, sin r sin y cos p - cos r sin p )
--
-- and the matrix's first column, which is up crossed with front, has
--
--   side.y = cos r sin y sin p - sin r cos p
--   side.z = cos r sin y cos p + sin r sin p
--
-- `euler` solves those for the angles. The cosine of the yaw is taken as the
-- length of front's y and z and never from the yaw, and the roll is taken from
-- up and side with no division by that cosine. Both matter for a unit facing
-- along x, where the cosine is next to nothing: in the engine's 32 bit floats
-- it came back from the yaw with the wrong sign, and the unit stood on its head.
-- Facing exactly along x the pitch is whatever `atan2` makes of two zeros, and
-- the roll is solved for that pitch, so the three still give the rotation.
--
-- It makes no table.

local atan2, sin, cos, sqrt = math.atan2, math.sin, math.cos, math.sqrt

local M = {}

--- The pitch, yaw and roll, in radians, that give the engine the rotation of
-- the quaternion (x, y, z, w).
function M.euler(x, y, z, w)
	local fx, fy, fz = 2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)
	local uy, uz = 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)
	local sideY, sideZ = 2 * (x * y + w * z), 2 * (x * z - w * y)
	local pitch = atan2(fy, fz)
	local sp, cp = sin(pitch), cos(pitch)
	return pitch, atan2(-fx, sqrt(fy * fy + fz * fz)), atan2(sideZ * sp - sideY * cp, uy * cp - uz * sp)
end

return M
