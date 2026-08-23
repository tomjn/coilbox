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
        // HEALTH: whole, on a 0 to 100 scale.
        4 => Some(100),
        // BUILD_PERCENT_LEFT: nothing left, so the unit is finished and working.
        17 => Some(0),
        // CURRENT_SPEED and MAX_SPEED, in 65536ths of an elmo per frame.
        29 | 75 => Some(65536),
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
