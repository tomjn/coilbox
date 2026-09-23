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
/// `XZ_ATAN` and `XZ_HYPOT` are here too. They take a map position packed into
/// one number, which looks like a question about the world, but the only thing
/// either reads from outside the arguments is the unit's own heading, and that
/// is 0 in the editor.
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
        // A packed pair, from a unit at heading 0, which is the only heading
        // the editor has.
        XZ_ATAN => {
            let (x, z) = unpack_xz(p1);
            sane(RAD2TAANG * x.atan2(z) + 32768.0)
        }
        XZ_HYPOT => {
            let (x, z) = unpack_xz(p1);
            sane(x.hypot(z) * COBSCALE)
        }
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
const XZ_ATAN: i32 = 12;
const XZ_HYPOT: i32 = 13;

/// Where one of the unit's own pieces is. Not answered here, because the
/// answer comes from the model each runtime holds, but named here so both
/// runtimes read it by the same name.
pub const PIECE_XZ: i32 = 7;
pub const PIECE_Y: i32 = 8;

/// A map position as a script holds one: x in the high half and z in the low,
/// each a whole number of elmos (`PACKXZ` in `CobInstance.h:10`).
pub fn pack_xz(x: f64, z: f64) -> i32 {
    ((x as i32) << 16).wrapping_add((z as i32) & 0xffff)
}

/// The two halves of a packed pair, signed, as `UNPACKX` and `UNPACKZ` read
/// them (`CobInstance.h:11-12`).
fn unpack_xz(xz: i32) -> (f32, f32) {
    let bits = xz as u32;
    (
        f32::from((bits >> 16) as u16 as i16),
        f32::from((bits & 0xffff) as u16 as i16),
    )
}

/// Unit values 1024 to 8191 once held numbers BOS scripts shared: 8 per unit,
/// 64 per team, 64 per allyteam and 4096 for the whole game. Spring 102.0
/// stopped keeping them and Recoil deleted them, so the engine answers 0 and
/// ignores a set.
pub fn removed_shared(id: i32) -> bool {
    matches!(id, 1024..=1031 | 2048..=2111 | 3072..=3135 | 4096..=8191)
}

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

/// Ids that ask where a unit is or how big it is, from `CobDefines.h`.
pub const UNIT_XZ: i32 = 9;
pub const UNIT_Y: i32 = 10;
pub const UNIT_HEIGHT: i32 = 11;
pub const GROUND_HEIGHT: i32 = 16;

/// What a question about the scene was answered with, and what the preview
/// wants said about it.
#[derive(Debug, Clone, PartialEq)]
pub struct Answer {
    pub value: i32,
    pub note: Option<String>,
}

/// Which unit an id means in a scene with at most two in it.
pub enum Who<'a> {
    Own(&'a crate::Size),
    StandIn(&'a crate::StandIn),
    Nobody,
}

/// The engine reads 0 or less as "this unit" (`UnitScript.cpp:1061`).
pub fn who(id: i64, world: &crate::World) -> Who<'_> {
    if id <= 0 || id == i64::from(UNIT_ID) {
        return Who::Own(&world.own);
    }
    match &world.stand_in {
        Some(stand_in) if i64::from(stand_in.id) == id => Who::StandIn(stand_in),
        _ => Who::Nobody,
    }
}

/// Where a unit is and how big, answered off the scene the event carried.
///
/// `rts/Sim/Units/Scripts/UnitScript.cpp:1060-1105`. The unit itself stands at
/// the origin, and the ground is flat at 0, which is what the viewport draws.
/// `carried` is where the stand-in is once a script has held it
/// ([`crate::Passenger::at`]), which the scene no longer decides.
/// `None` for an id this does not cover, and for one it cannot answer without
/// a scene, so the caller's own "no world" note still says so.
pub fn world(
    id: i32,
    p1: i32,
    world: Option<&crate::World>,
    carried: Option<[f64; 3]>,
) -> Option<Answer> {
    let plain = |value: i32| Answer { value, note: None };
    if !matches!(id, UNIT_XZ | UNIT_Y | UNIT_HEIGHT | GROUND_HEIGHT) {
        return None;
    }
    if id == GROUND_HEIGHT {
        return Some(plain(0));
    }
    let asks_itself = p1 <= 0 || p1 == UNIT_ID;
    if asks_itself && id != UNIT_HEIGHT {
        return Some(plain(0));
    }
    let world = world?;
    let stand_in = match who(i64::from(p1), world) {
        Who::Own(own) => return Some(plain((own.radius * f64::from(COBSCALE)) as i32)),
        Who::Nobody => return Some(plain(0)),
        Who::StandIn(stand_in) => stand_in,
    };
    if id == UNIT_HEIGHT {
        return Some(plain((stand_in.radius * f64::from(COBSCALE)) as i32));
    }
    let Some(pos) = carried.or(stand_in.pos) else {
        return Some(Answer {
            value: 0,
            note: Some(
                "This script asks where the stand-in is on a frame this scenario puts it nowhere, so it read 0."
                    .to_string(),
            ),
        });
    };
    Some(plain(match id {
        UNIT_XZ => pack_xz(pos[0], pos[2]),
        UNIT_Y => (pos[1] * f64::from(COBSCALE)) as i32,
        // The radius, which is what the engine answers under this name.
        _ => (stand_in.radius * f64::from(COBSCALE)) as i32,
    }))
}

/// Ids [`crate::Timeline::asked`] leaves out, because none of them is a
/// question about the unit that a control could stand in for: the arithmetic
/// call-outs, the shared values Spring stopped keeping, the running frame, the
/// packed piece-position pair, the slots a `.cob`'s Lua call answers in, and
/// the questions about where a unit is, which a control keyed by id alone
/// cannot tell apart from one unit to the next.
///
/// `arithmetic` always answers the same way for a given id regardless of its
/// arguments, being `Some` for exactly the ids it has a match arm for, so
/// asking it with zeroes is a membership test rather than a real calculation.
fn excluded_from_asked(id: i32) -> bool {
    const GAME_FRAME: i32 = 134;
    const LUA0: i32 = 110;
    const LUA9: i32 = 119;
    arithmetic(id, 0, 0).is_some()
        || removed_shared(id)
        || id == GAME_FRAME
        || id == PIECE_XZ
        || id == PIECE_Y
        || (LUA0..=LUA9).contains(&id)
        || matches!(id, UNIT_XZ | UNIT_Y | UNIT_HEIGHT | GROUND_HEIGHT)
}

/// Note that a script read unit value `id`, unless it is one [`Timeline::asked`]
/// leaves out or has already been noted.
///
/// Shared between the two runtimes so a script's own values controls are the
/// same whichever one ran it: the two are asked the same questions by the same
/// numbers and have to agree on which of them are worth a control.
///
/// [`Timeline::asked`]: crate::Timeline::asked
pub fn note_asked(asked: &mut Vec<crate::AskedValue>, id: i32) {
    if excluded_from_asked(id) || asked.iter().any(|value| value.id == id) {
        return;
    }
    let name = NAMES
        .iter()
        .find(|(_, value)| *value == id)
        .map(|(name, _)| (*name).to_string());
    asked.push(crate::AskedValue {
        id,
        name,
        default: known(id),
    });
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
        // Half a circle is 32768, and it lands either side of that by one:
        // the product is computed in single precision and then truncated, so
        // which side depends on the machine. The engine's own answer moves
        // with it for the same reason, being the same arithmetic.
        let half = arithmetic(ATAN, 0, -1).unwrap();
        assert!((32767..=32768).contains(&half), "{half}");
        assert_eq!(arithmetic(HYPOT, 3, 4), Some(5));
    }

    /// The values BOS scripts once shared, which Spring 102.0 stopped keeping.
    /// The edges matter, because the ids between the ranges were never shared
    /// and still reach the engine.
    #[test]
    fn knows_which_values_were_shared() {
        for id in [1024, 1031, 2048, 2111, 3072, 3135, 4096, 8191] {
            assert!(removed_shared(id), "{id}");
        }
        for id in [1023, 1032, 2047, 2112, 3071, 3136, 4095, 8192, 93, 103] {
            assert!(!removed_shared(id), "{id}");
        }
    }

    /// The engine logs and answers zero rather than handing back a number that
    /// is not one.
    #[test]
    fn answers_zero_where_there_is_no_number() {
        assert_eq!(arithmetic(SQRT, -1, 0), Some(0));
    }

    /// `XZ_ATAN` is the heading to a packed x and z, turned half a circle and
    /// less the unit's own heading, which is 0 in the editor
    /// (`rts/Sim/Units/Scripts/UnitScript.cpp:1094-1095`).
    #[test]
    fn heads_towards_a_packed_pair() {
        // Straight ahead is atan2(0, 1), nothing, plus half a circle.
        assert_eq!(arithmetic(XZ_ATAN, pack_xz(0.0, 1.0), 0), Some(32768));
        // A quarter circle round is 16384, plus the half.
        assert_eq!(arithmetic(XZ_ATAN, pack_xz(1.0, 0.0), 0), Some(49152));
    }

    /// `XZ_HYPOT` is how far a packed x and z is, in 65536ths
    /// (`UnitScript.cpp:1096-1097`).
    #[test]
    fn measures_a_packed_pair() {
        assert_eq!(arithmetic(XZ_HYPOT, pack_xz(3.0, 4.0), 0), Some(5 * 65536));
    }

    /// The halves are signed, so a pair to the right and behind unpacks as
    /// negative rather than as a very large number.
    #[test]
    fn unpacks_a_negative_pair() {
        assert_eq!(
            arithmetic(XZ_HYPOT, pack_xz(-3.0, -4.0), 0),
            Some(5 * 65536)
        );
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

    /// A read is noted once, by name, with the default a reset would put back.
    #[test]
    fn notes_a_read_by_name_and_default_once() {
        let activation = NAMES
            .iter()
            .find(|(name, _)| *name == "ACTIVATION")
            .unwrap()
            .1;
        let mut asked = Vec::new();
        note_asked(&mut asked, HEALTH);
        note_asked(&mut asked, HEALTH);
        note_asked(&mut asked, activation);

        assert_eq!(asked.len(), 2, "{asked:?}");
        assert_eq!(asked[0].name.as_deref(), Some("HEALTH"));
        assert_eq!(asked[0].default, Some(100));
        assert_eq!(asked[1].name.as_deref(), Some("ACTIVATION"));
        assert_eq!(asked[1].default, None);
    }

    /// None of these describe the unit, so a control for one of them would not
    /// mean anything.
    #[test]
    fn leaves_out_ids_that_are_not_questions_about_the_unit() {
        let mut asked = Vec::new();
        for id in [ABS, 1024, 134, 7, 8, 110, 119] {
            note_asked(&mut asked, id);
        }
        assert!(asked.is_empty(), "{asked:?}");
    }

    fn scene(pos: Option<[f64; 3]>) -> crate::World {
        crate::World {
            stand_in: Some(crate::StandIn {
                id: 2,
                pos,
                radius: 28.0,
                height: 30.8,
            }),
            own: crate::Size {
                radius: 60.0,
                height: 40.0,
            },
        }
    }

    fn value(id: i32, p1: i32, world: Option<&crate::World>) -> Option<i32> {
        self::world(id, p1, world, None).map(|answer| answer.value)
    }

    /// `rts/Sim/Units/Scripts/UnitScript.cpp:1060-1092`, a cell at a time.
    #[test]
    fn answers_for_the_unit_itself_from_the_origin() {
        let w = scene(Some([10.0, 2.0, 84.0]));
        for asker in [0, -1, UNIT_ID] {
            assert_eq!(value(UNIT_XZ, asker, Some(&w)), Some(0));
            assert_eq!(value(UNIT_Y, asker, Some(&w)), Some(0));
            assert_eq!(value(UNIT_HEIGHT, asker, Some(&w)), Some(60 * 65536));
        }
    }

    #[test]
    fn answers_for_the_stand_in_from_where_it_is() {
        let w = scene(Some([10.0, 2.0, 84.0]));
        assert_eq!(value(UNIT_XZ, 2, Some(&w)), Some(pack_xz(10.0, 84.0)));
        assert_eq!(value(UNIT_Y, 2, Some(&w)), Some(2 * 65536));
        // The radius, not the height: `UnitScript.cpp:1082-1092`.
        assert_eq!(value(UNIT_HEIGHT, 2, Some(&w)), Some(28 * 65536));
    }

    /// The engine's answer for a unit that does not exist, which is not a gap
    /// in the preview and so carries no note.
    #[test]
    fn answers_zero_for_a_unit_that_is_not_there() {
        let w = scene(Some([10.0, 2.0, 84.0]));
        let answer = world(UNIT_XZ, 7, Some(&w), None).unwrap();
        assert_eq!(answer.value, 0);
        assert_eq!(answer.note, None);
    }

    #[test]
    fn says_so_when_the_stand_in_is_nowhere_on_this_frame() {
        let answer = world(UNIT_XZ, 2, Some(&scene(None)), None).unwrap();
        assert_eq!(answer.value, 0);
        assert!(answer.note.is_some());
    }

    /// `UnitScript.cpp:1082-1092` answers the radius regardless of position,
    /// as `GetUnitRadius` already does, so a missing position should not
    /// blank out the stand-in's height.
    #[test]
    fn answers_the_stand_ins_height_even_when_it_is_nowhere_on_this_frame() {
        assert_eq!(value(UNIT_HEIGHT, 2, Some(&scene(None))), Some(28 * 65536));
        assert_eq!(
            world(UNIT_HEIGHT, 2, Some(&scene(None)), None)
                .unwrap()
                .note,
            None
        );
    }

    /// Once a script holds the stand-in, the runtime says where it is and the
    /// scene does not. Its size still comes from the scene.
    #[test]
    fn answers_a_carried_stand_in_from_where_it_is_carried() {
        let w = scene(Some([10.0, 2.0, 84.0]));
        let carried = Some([1.0, 2.0, 3.0]);
        assert_eq!(
            world(UNIT_XZ, 2, Some(&w), carried).map(|a| a.value),
            Some(pack_xz(1.0, 3.0))
        );
        assert_eq!(
            world(UNIT_Y, 2, Some(&w), carried).map(|a| a.value),
            Some(2 * 65536)
        );
        assert_eq!(
            world(UNIT_HEIGHT, 2, Some(&w), carried).map(|a| a.value),
            Some(28 * 65536)
        );
    }

    /// A scene that puts the stand-in nowhere does not matter once it is held.
    #[test]
    fn a_carried_stand_in_is_somewhere_even_when_the_scene_says_nowhere() {
        let answer = world(UNIT_XZ, 2, Some(&scene(None)), Some([1.0, 0.0, 3.0])).unwrap();
        assert_eq!(answer.value, pack_xz(1.0, 3.0));
        assert_eq!(answer.note, None);
    }

    #[test]
    fn the_ground_is_flat_at_zero_everywhere() {
        assert_eq!(value(GROUND_HEIGHT, pack_xz(100.0, -50.0), None), Some(0));
    }

    /// No world at all is every caller outside the panel. What needs no facts
    /// is still answered, and the rest is left for the caller's note.
    #[test]
    fn answers_what_needs_no_facts_when_given_no_world() {
        assert_eq!(value(UNIT_XZ, 0, None), Some(0));
        assert_eq!(value(UNIT_Y, 0, None), Some(0));
        assert_eq!(value(UNIT_HEIGHT, 0, None), None);
        assert_eq!(value(UNIT_XZ, 2, None), None);
    }

    #[test]
    fn leaves_everything_else_to_the_caller() {
        assert!(world(HEALTH, 0, Some(&scene(None)), None).is_none());
    }

    #[test]
    fn offers_no_control_for_a_question_about_the_world() {
        let mut asked = Vec::new();
        for id in [UNIT_XZ, UNIT_Y, UNIT_HEIGHT, GROUND_HEIGHT] {
            note_asked(&mut asked, id);
        }
        assert!(asked.is_empty(), "{asked:?}");
    }
}
