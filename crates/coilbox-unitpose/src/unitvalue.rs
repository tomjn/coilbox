//! The numbered questions a unit script asks about its unit, and what a preview
//! answers.
//!
//! A script asks with `get <NAME>` in compiled BOS and
//! `Spring.UnitScript.GetUnitValue(COB.<NAME>)` in Lua, and both are the same
//! numbered id underneath. The names and their numbers are the engine's, read
//! from `rts/Sim/Units/Scripts/CobDefines.h` and `rts/Lua/LuaConstCOB.cpp`
//! rather than guessed at.
//!
//! It is here, beside the motion, for the reason the motion is: the two
//! runtimes have to answer the same question the same way. A unit whose game
//! compiled its script and a unit whose game wrote it in Lua ask about their
//! health identically, and a preview that told them different things would
//! animate the same unit two ways.

/// Every name the engine puts in a unit script's `COB` table, with its id.
///
/// The engine's own list from `LuaConstCOB::PushEntries`, in its order. The ids
/// a script can only reach from compiled code are left out for the same reason
/// the engine leaves them out of Lua.
pub const NAMES: &[(&str, i32)] = &[
    ("ACTIVATION", 1),
    ("STANDINGMOVEORDERS", 2),
    ("STANDINGFIREORDERS", 3),
    ("HEALTH", 4),
    ("INBUILDSTANCE", 5),
    ("BUSY", 6),
    ("PIECE_XZ", 7),
    ("PIECE_Y", 8),
    ("UNIT_XZ", 9),
    ("UNIT_Y", 10),
    ("UNIT_HEIGHT", 11),
    ("XZ_ATAN", 12),
    ("XZ_HYPOT", 13),
    ("ATAN", 14),
    ("HYPOT", 15),
    ("GROUND_HEIGHT", 16),
    ("BUILD_PERCENT_LEFT", 17),
    ("YARD_OPEN", 18),
    ("BUGGER_OFF", 19),
    ("ARMORED", 20),
    ("IN_WATER", 28),
    ("CURRENT_SPEED", 29),
    ("VETERAN_LEVEL", 32),
    ("ON_ROAD", 34),
    ("MAX_ID", 70),
    ("MY_ID", 71),
    ("UNIT_TEAM", 72),
    ("UNIT_BUILD_PERCENT_LEFT", 73),
    ("UNIT_ALLIED", 74),
    ("MAX_SPEED", 75),
    ("CLOAKED", 76),
    ("WANT_CLOAK", 77),
    ("GROUND_WATER_HEIGHT", 78),
    ("UPRIGHT", 79),
    ("POW", 80),
    ("PRINT", 81),
    ("HEADING", 82),
    ("TARGET_ID", 83),
    ("LAST_ATTACKER_ID", 84),
    ("LOS_RADIUS", 85),
    ("AIR_LOS_RADIUS", 86),
    ("RADAR_RADIUS", 87),
    ("JAMMER_RADIUS", 88),
    ("SONAR_RADIUS", 89),
    ("SONAR_JAM_RADIUS", 90),
    ("SEISMIC_RADIUS", 91),
    ("DO_SEISMIC_PING", 92),
    ("CURRENT_FUEL", 93),
    ("TRANSPORT_ID", 94),
    ("SHIELD_POWER", 95),
    ("STEALTH", 96),
    ("CRASHING", 97),
    ("CHANGE_TARGET", 98),
    ("CEG_DAMAGE", 99),
    ("COB_ID", 100),
    ("PLAY_SOUND", 101),
    ("KILL_UNIT", 102),
    ("SET_WEAPON_UNIT_TARGET", 106),
    ("SET_WEAPON_GROUND_TARGET", 107),
    ("SONAR_STEALTH", 108),
    ("REVERSING", 109),
    ("FLANK_B_MODE", 120),
    ("FLANK_B_DIR", 121),
    ("FLANK_B_MOBILITY_ADD", 122),
    ("FLANK_B_MAX_DAMAGE", 123),
    ("FLANK_B_MIN_DAMAGE", 124),
    ("WEAPON_RELOADSTATE", 125),
    ("WEAPON_RELOADTIME", 126),
    ("WEAPON_ACCURACY", 127),
    ("WEAPON_SPRAY", 128),
    ("WEAPON_RANGE", 129),
    ("WEAPON_PROJECTILE_SPEED", 130),
    ("MIN", 131),
    ("MAX", 132),
    ("ABS", 133),
    ("GAME_FRAME", 134),
    ("PIECE_HEADING", 139),
    ("PIECE_PITCH", 140),
];

/// The unit's own id, which is 1 because a preview runs one unit.
///
/// Shared so that a script asking `MY_ID`, a script reading `unitID`, and
/// anything either of them hands that id to all mean the same unit.
pub const UNIT_ID: i32 = 1;

/// COB's fixed-point scale: 65536ths of an elmo, or of a full circle.
const COBSCALE: f32 = 65536.0;

/// Radians to COB angular units, and back. The engine's `RAD2TAANG` and
/// `TAANG2RAD`.
const RAD2TAANG: f32 = 32768.0 / std::f32::consts::PI;
const TAANG2RAD: f32 = std::f32::consts::PI / 32768.0;

/// The maths a script does through the same call it asks questions with.
///
/// A `.cob` has no arithmetic beyond the four operations, so a script wanting a
/// sine, a square root or an absolute value asks the engine for one through
/// `get`, using an id that sits in the same numbering as `HEALTH` and
/// `GROUND_HEIGHT`. These are not questions about the world and there is
/// nothing to stand in for: they have exact answers, and returning zero for
/// `ABS` quietly breaks whatever the script was calculating.
///
/// Worth having: 205 of the 848 compiled scripts Beyond All Reason ships ask
/// for `ABS`, 139 for `MAX` and 100 for `KSIN`.
///
/// Every one is the engine's own line from `CUnitScript::GetUnitVal`, in `f32`
/// because that is what the engine computes in and a preview that rounded
/// differently would animate differently. A result that is not a number comes
/// back as zero, which is what the engine does after it logs.
///
/// `XZ_ATAN` and `XZ_HYPOT` are deliberately not here. They take a pair of map
/// coordinates packed into one number, so a script asking either is asking
/// about a world the preview has none of, whatever the arithmetic.
pub fn arithmetic(id: i32, p1: i32, p2: i32) -> Option<i32> {
    let sane = |value: f32| Some(if value.is_finite() { value as i32 } else { 0 });
    match id {
        // On a pair of fixed-point numbers, answering in the same.
        POW => sane((p1 as f32 / COBSCALE).powf(p2 as f32 / COBSCALE) * COBSCALE),
        // In COB angular units, and in whatever it was given.
        ATAN => sane(RAD2TAANG * (p1 as f32).atan2(p2 as f32)),
        HYPOT => sane((p1 as f32).hypot(p2 as f32)),
        MIN => Some(p1.min(p2)),
        MAX => Some(p1.max(p2)),
        ABS => Some(p1.abs()),
        // A thousand and twenty four times the ratio, of an angle in COB units.
        KSIN => sane(1024.0 * (TAANG2RAD * p1 as f32).sin()),
        KCOS => sane(1024.0 * (TAANG2RAD * p1 as f32).cos()),
        KTAN => sane(1024.0 * (TAANG2RAD * p1 as f32).tan()),
        // Nothing for a negative, and it says so the same way.
        SQRT => sane((p1 as f32).sqrt()),
        _ => None,
    }
}

/// The ids the maths above goes by, from `CobDefines.h`.
///
/// Four of them are missing from [`NAMES`], which is not an oversight in either
/// place: the engine does not put `KSIN`, `KCOS`, `KTAN` or `SQRT` in the `COB`
/// table it gives Lua, because a Lua script has `math` and only a `.cob` needs
/// to ask.
const ATAN: i32 = 14;
const HYPOT: i32 = 15;
const POW: i32 = 80;
const MIN: i32 = 131;
const MAX: i32 = 132;
const ABS: i32 = 133;
const KSIN: i32 = 135;
const KCOS: i32 = 136;
const KTAN: i32 = 137;
const SQRT: i32 = 138;

/// Ids that [`known`] answers, named for the same reason.
const HEALTH: i32 = 4;
const BUILD_PERCENT_LEFT: i32 = 17;
const CURRENT_SPEED: i32 = 29;
const MY_ID: i32 = 71;
const HEADING: i32 = 82;
const IN_WATER: i32 = 28;
const MAX_SPEED: i32 = 75;
/// The packed pair of map coordinates, which is not arithmetic however it looks.
const XZ_ATAN: i32 = 12;

/// What a preview answers, for the questions that have an answer.
///
/// Every one of these describes a whole unit doing what the scenario says, and
/// the numbers are the engine's own scaling. They are answers rather than
/// stand-ins, which is why a caller reports no note for them.
///
/// `MAX_SPEED` is the one that has to be here. A walking unit works its leg
/// speed out as its current speed over its top speed, so leaving that zero
/// divides by zero and the unit stands still with its legs mid-stride. Both are
/// one elmo per frame, so a unit told to move walks at the pace it was animated
/// for.
///
/// Anything else is about a world the preview has none of. The caller answers
/// zero and says so, because a script asking where the ground is deserves to be
/// told nobody knows rather than quietly handed sea level.
pub fn known(id: i32) -> Option<i32> {
    match id {
        // Whole, on a 0 to 100 scale.
        HEALTH => Some(100),
        // Nothing left, so the unit is finished and working.
        BUILD_PERCENT_LEFT => Some(0),
        // In 65536ths of an elmo per frame.
        CURRENT_SPEED | MAX_SPEED => Some(65536),
        // The one unit the preview has.
        MY_ID => Some(UNIT_ID),
        // Facing the way it was made facing. The preview never turns the unit
        // as a whole, and 202 of Beyond All Reason's compiled scripts ask,
        // mostly to work out where a weapon is pointing relative to the hull.
        HEADING => Some(0),
        // Standing on land, which is what every scenario tells the unit it is
        // standing on and what the ground plane under it in the viewport shows.
        IN_WATER => Some(0),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The four the runtimes agree on, by the names a script uses.
    #[test]
    fn answers_what_a_finished_unit_would() {
        let id = |want: &str| NAMES.iter().find(|(name, _)| *name == want).unwrap().1;
        assert_eq!(known(id("HEALTH")), Some(100));
        assert_eq!(known(id("BUILD_PERCENT_LEFT")), Some(0));
        assert_eq!(known(id("CURRENT_SPEED")), known(id("MAX_SPEED")));
    }

    /// A question about the world, which a preview has none of.
    #[test]
    fn answers_nothing_about_the_world() {
        let id = |want: &str| NAMES.iter().find(|(name, _)| *name == want).unwrap().1;
        assert_eq!(known(id("GROUND_HEIGHT")), None);
    }

    /// The arithmetic a `.cob` cannot do for itself, which is why it asks.
    #[test]
    fn does_the_maths_a_script_asks_for() {
        assert_eq!(arithmetic(ABS, -7, 0), Some(7));
        assert_eq!(arithmetic(MIN, 3, 9), Some(3));
        assert_eq!(arithmetic(MAX, 3, 9), Some(9));
        // A quarter circle is 16384 COB units, where the sine is one.
        assert_eq!(arithmetic(KSIN, 16384, 0), Some(1024));
        assert_eq!(arithmetic(KCOS, 0, 0), Some(1024));
        assert_eq!(arithmetic(SQRT, 144, 0), Some(12));
        // A quarter circle round, which is what atan2(1, 0) is.
        assert_eq!(arithmetic(ATAN, 1, 0), Some(16384));
        // Half a circle is 32768, and it comes back one short because the
        // engine truncates the same single-precision product this does.
        assert_eq!(arithmetic(ATAN, 0, -1), Some(32767));
        assert_eq!(arithmetic(HYPOT, 3, 4), Some(5));
    }

    /// The engine logs and answers zero rather than handing back a number that
    /// is not one.
    #[test]
    fn answers_zero_where_there_is_no_number() {
        assert_eq!(arithmetic(SQRT, -1, 0), Some(0));
    }

    /// A question about the world is not arithmetic, whatever the sums inside
    /// it: this one takes a pair of map coordinates packed into a number.
    #[test]
    fn does_not_answer_the_packed_coordinate_pair() {
        assert_eq!(arithmetic(XZ_ATAN, 1, 0), None);
    }

    /// Two names sharing an id would be a typo in the transcription, and one of
    /// them would then be silently answering for the other.
    #[test]
    fn every_name_has_its_own_id() {
        let mut ids: Vec<i32> = NAMES.iter().map(|(_, id)| *id).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count);
    }
}
