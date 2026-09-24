//! What the runtime has to get right for a preview to be worth trusting: the
//! motion semantics, the scheduler, and every way a script can fail.

use super::*;

const TAU: f64 = std::f64::consts::TAU;

const PIECES: &[&str] = &["base", "turret", "barrel", "flare"];

fn pieces() -> Vec<String> {
    PIECES.iter().map(|name| (*name).to_string()).collect()
}

fn create() -> Vec<ScriptEvent> {
    vec![ScriptEvent {
        frame: 0,
        callin: "Create".to_string(),
        args: Vec::new(),
        ambient: false,
        world: None,
        engine: None,
    }]
}

fn play(script: &str, frames: u32) -> Timeline {
    run(
        script,
        "test.lua",
        &Unit::new(&pieces()),
        &create(),
        frames,
        &HashMap::new(),
    )
}

fn play_with_values(script: &str, frames: u32, values: &HashMap<i32, i32>) -> Timeline {
    run(
        script,
        "test.lua",
        &Unit::new(&pieces()),
        &create(),
        frames,
        values,
    )
}

/// One piece's numbers on one frame: x, y, z offset then x, y, z rotation.
fn pose(timeline: &Timeline, frame: usize, piece: &str) -> [f64; 6] {
    let index = timeline
        .pieces
        .iter()
        .position(|name| name == piece)
        .expect("piece is in the timeline");
    let row = &timeline.frames[frame];
    let mut out = [0.0; 6];
    out.copy_from_slice(&row[index * 6..index * 6 + 6]);
    out
}

fn rot_y(timeline: &Timeline, frame: usize, piece: &str) -> f64 {
    pose(timeline, frame, piece)[4]
}

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-6,
        "expected {expected}, got {actual}"
    );
}

/// A unit opened out of a game carries two spellings of each piece name: the
/// one its model file uses, and the lower case one coilbox gives its pieces so
/// that a generated script's locals are valid Lua identifiers. A game's own
/// script names the first.
///
/// flove is where this showed. Its models name a piece `Trunk`, its unit
/// definitions ask for `Trunk`, and every animation raised against a piece list
/// holding `trunk`.
#[test]
fn a_script_may_name_a_piece_in_the_case_its_model_file_used() {
    let timeline = play(
        r#"
        local turret = piece("Turret")
        function script.Create()
            Turn(turret, y_axis, 1.0)
        end
        "#,
        3,
    );
    assert_eq!(timeline.error, None);
    assert_close(rot_y(&timeline, 0, "turret"), 1.0);
}

/// A second look rather than a loose one. A name no piece answers to in any
/// case still says so, because a script naming a piece that is genuinely not
/// there is a script the engine refuses to load.
#[test]
fn a_piece_that_is_not_there_in_any_case_still_fails() {
    let timeline = play(
        r#"
        local ghost = piece("ghost")
        function script.Create()
            Turn(ghost, y_axis, 1.0)
        end
        "#,
        3,
    );
    assert!(
        timeline.error.is_some(),
        "a piece that does not exist should still be reported"
    );
}

#[test]
fn turns_toward_the_target_at_the_speed_given() {
    // One radian a second: a tenth of a radian after three frames.
    let timeline = play(
        r#"
        local turret = piece("turret")
        function script.Create()
            Turn(turret, y_axis, 1.0, 1.0)
        end
        "#,
        40,
    );
    assert_eq!(timeline.error, None);
    assert_close(rot_y(&timeline, 0, "turret"), 0.0);
    assert_close(rot_y(&timeline, 3, "turret"), 3.0 / 30.0);
    // Arrived by frame 30 and stopped there rather than overshooting.
    assert_close(rot_y(&timeline, 30, "turret"), 1.0);
    assert_close(rot_y(&timeline, 39, "turret"), 1.0);
}

#[test]
fn a_turn_with_no_speed_is_instant() {
    let timeline = play(
        r#"
        local turret = piece("turret")
        function script.Create()
            Turn(turret, y_axis, 1.0)
        end
        "#,
        3,
    );
    assert_eq!(timeline.error, None);
    assert_close(rot_y(&timeline, 0, "turret"), 1.0);
}

/// A turn takes the shortest way round, and the angle it reports is the
/// engine's, which is always positive. Turning to -1 is turning backwards to
/// 5.28, not forwards to it.
#[test]
fn a_turn_backwards_takes_the_short_way() {
    let timeline = play(
        r#"
        local turret = piece("turret")
        function script.Create()
            Turn(turret, y_axis, -1.0, 1.0)
        end
        "#,
        40,
    );
    assert_close(rot_y(&timeline, 3, "turret"), TAU - 3.0 / 30.0);
    assert_close(rot_y(&timeline, 30, "turret"), TAU - 1.0);
}

#[test]
fn move_travels_and_stops_at_the_destination() {
    let timeline = play(
        r#"
        local barrel = piece("barrel")
        function script.Create()
            Move(barrel, z_axis, -3, 6)
        end
        "#,
        40,
    );
    assert_eq!(timeline.error, None);
    // Six elmos a second, three to travel: half a second, fifteen frames.
    assert_close(pose(&timeline, 5, "barrel")[2], -1.0);
    assert_close(pose(&timeline, 15, "barrel")[2], -3.0);
    assert_close(pose(&timeline, 39, "barrel")[2], -3.0);
}

#[test]
fn spin_keeps_going_and_stays_in_range() {
    let timeline = play(
        r#"
        local turret = piece("turret")
        function script.Create()
            Spin(turret, y_axis, 3.0)
        end
        "#,
        300,
    );
    assert_eq!(timeline.error, None);
    // Create runs after the frame's animation tick, so a spin started there
    // first moves on the frame after it.
    assert_close(rot_y(&timeline, 1, "turret"), 3.0 / 30.0);
    assert_close(rot_y(&timeline, 10, "turret"), 1.0);
    // Ten seconds of spinning is nearly five turns, and the angle is still a
    // number the viewport can use rather than a growing one.
    for frame in 0..300 {
        let angle = rot_y(&timeline, frame, "turret");
        assert!((0.0..TAU).contains(&angle), "frame {frame} is at {angle}");
    }
}

/// A spin's acceleration is per frame, not per second: the engine adds it to
/// the speed once a tick.
#[test]
fn spin_accelerates_up_to_speed() {
    let timeline = play(
        r#"
        local turret = piece("turret")
        function script.Create()
            Spin(turret, y_axis, 3.0, 0.1)
        end
        "#,
        60,
    );
    // A tenth of a radian a second, gained on the first frame it runs.
    assert_close(rot_y(&timeline, 1, "turret"), 0.1 / 30.0);
    // Up to speed after thirty frames, and no faster after that.
    let before = rot_y(&timeline, 40, "turret");
    let after = rot_y(&timeline, 41, "turret");
    assert_close(after - before, 3.0 / 30.0);
}

#[test]
fn stop_spin_with_no_deceleration_stops_dead() {
    let timeline = play(
        r#"
        local turret = piece("turret")
        function script.Create()
            Spin(turret, y_axis, 3.0)
            Sleep(1000)
            StopSpin(turret, y_axis)
        end
        "#,
        90,
    );
    assert_eq!(timeline.error, None);
    let stopped = rot_y(&timeline, 40, "turret");
    assert_close(rot_y(&timeline, 89, "turret"), stopped);
}

#[test]
fn a_turn_replaces_the_spin_on_the_same_axis() {
    let timeline = play(
        r#"
        local turret = piece("turret")
        function script.Create()
            Spin(turret, y_axis, 3.0)
            Sleep(500)
            Turn(turret, y_axis, 0, 10)
        end
        "#,
        90,
    );
    assert_eq!(timeline.error, None);
    assert_close(rot_y(&timeline, 89, "turret"), 0.0);
}

#[test]
fn sleep_costs_the_frames_it_says() {
    // 233ms is a seventh of a second and rounds to seven frames, which is what
    // the generated walk script's quarter cycle asks for.
    let timeline = play(
        r#"
        local turret = piece("turret")
        function script.Create()
            Sleep(233)
            Turn(turret, y_axis, 1.0)
        end
        "#,
        12,
    );
    assert_eq!(timeline.error, None);
    assert_close(rot_y(&timeline, 6, "turret"), 0.0);
    assert_close(rot_y(&timeline, 7, "turret"), 1.0);
}

#[test]
fn wait_for_turn_resumes_when_the_turn_lands() {
    let timeline = play(
        r#"
        local turret = piece("turret")
        local barrel = piece("barrel")
        function script.Create()
            Turn(turret, y_axis, 1.0, 1.0)
            WaitForTurn(turret, y_axis)
            Turn(barrel, x_axis, 0.5)
        end
        "#,
        40,
    );
    assert_eq!(timeline.error, None);
    assert_close(pose(&timeline, 29, "barrel")[3], 0.0);
    assert_close(pose(&timeline, 30, "barrel")[3], 0.5);
}

/// The engine asks whether there is anything to wait for before it suspends, so
/// a wait on an axis standing still does not even cost a frame.
#[test]
fn waiting_on_an_axis_with_nothing_on_it_does_not_hang() {
    let timeline = play(
        r#"
        local turret = piece("turret")
        function script.Create()
            WaitForTurn(turret, y_axis)
            Turn(turret, y_axis, 1.0)
        end
        "#,
        5,
    );
    assert_eq!(timeline.error, None);
    assert_close(rot_y(&timeline, 0, "turret"), 1.0);
}

#[test]
fn a_started_thread_runs_on_its_own() {
    let timeline = play(
        r#"
        local turret = piece("turret")
        local function sweep()
            while true do
                Turn(turret, y_axis, 1.0, 2.0)
                Sleep(1000)
                Turn(turret, y_axis, -1.0, 2.0)
                Sleep(1000)
            end
        end
        function script.Create() StartThread(sweep) end
        "#,
        90,
    );
    assert_eq!(timeline.error, None);
    assert_close(rot_y(&timeline, 15, "turret"), 1.0);
    assert_close(rot_y(&timeline, 60, "turret"), TAU - 1.0);
}

#[test]
fn a_started_thread_takes_its_arguments() {
    let timeline = play(
        r#"
        local turret = piece("turret")
        local function to(angle) Turn(turret, y_axis, angle) end
        function script.Create() StartThread(to, 0.25) end
        "#,
        3,
    );
    assert_eq!(timeline.error, None);
    assert_close(rot_y(&timeline, 0, "turret"), 0.25);
}

/// The mask a table stands for, which the engine allows and flove relies on: it
/// gives each shared animation library a fresh table so that one unit's walk
/// cycle cannot signal another's. Two tables are two masks however alike they
/// look, so the sweep has to survive a signal raised with the other one.
#[test]
fn a_table_is_a_mask_of_its_own() {
    // The turn is on the far side of a sleep, so it happens only if the thread
    // is still alive to reach it. A turn already running would not do: killing
    // the thread that asked for one does not stop the engine finishing it.
    let script = r#"
        local turret = piece("turret")
        local SIG, OTHER = {}, {}
        local function sweep()
            SetSignalMask(SIG)
            Sleep(100)
            Turn(turret, y_axis, 1.5)
        end
        function script.Create() StartThread(sweep) end
        function script.StopMoving() Signal(RAISED) end
        "#;
    let events = [
        ScriptEvent {
            frame: 0,
            callin: "Create".to_string(),
            args: Vec::new(),
            ambient: false,
            world: None,
            engine: None,
        },
        ScriptEvent {
            frame: 1,
            callin: "StopMoving".to_string(),
            args: Vec::new(),
            ambient: false,
            world: None,
            engine: None,
        },
    ];
    let names = pieces();

    // Signalled with the sweep's own table, it never wakes.
    let killed = run(
        &script.replace("RAISED", "SIG"),
        "test.lua",
        &Unit::new(&names),
        &events,
        10,
        &HashMap::new(),
    );
    assert_eq!(killed.error, None);
    assert_close(rot_y(&killed, 9, "turret"), 0.0);

    // Signalled with the other table, it wakes and turns.
    let spared = run(
        &script.replace("RAISED", "OTHER"),
        "test.lua",
        &Unit::new(&names),
        &events,
        10,
        &HashMap::new(),
    );
    assert_eq!(spared.error, None);
    assert_close(rot_y(&spared, 9, "turret"), 1.5);
}

/// The fields the engine builds for each of a unit's weapons, which are not the
/// ones the definition file writes. A weapon mount reads `slavedTo` to find out
/// which weapon it follows and `mainDirZ` to find out which way it faces, and
/// both were missing, which stopped the thread that sets up the animations.
#[test]
fn a_weapon_carries_the_fields_the_engine_builds() {
    let def = serde_json::json!({
        "unitname": "mushroom",
        "weapondefs": { "spray": { "weapontype": "Cannon" } },
        "weapons": {
            "1": { "name": "spray", "maindir": "0 0 -1", "maxangledif": 180, "slaveto": 2 },
        },
    });
    let names = pieces();
    let timeline = run(
        r#"
        function script.Create()
            local weapon = UnitDefs[unitDefID].weapons[1]
            if weapon.slavedTo ~= 2 then error("slavedTo is " .. tostring(weapon.slavedTo)) end
            -- The file gives the full arc and the engine keeps the cosine of
            -- half of it, so 180 degrees arrives as the cosine of 90, or zero.
            if math.abs(weapon.maxAngleDif) > 0.0001 then
                error("maxAngleDif is " .. tostring(weapon.maxAngleDif))
            end
            -- Moved rather than turned: a rotation is reported inside one turn,
            -- so a direction of -1 would come back as one turn less one.
            Move(piece("turret"), z_axis, weapon.mainDirZ)
        end
        "#,
        "test.lua",
        &Unit {
            def: Some(&def),
            ..Unit::new(&names)
        },
        &create(),
        3,
        &HashMap::new(),
    );

    assert_eq!(timeline.error, None);
    assert_close(pose(&timeline, 0, "turret")[2], -1.0);
}

/// A weapon that says none of it. Forward and slaved to nothing, which is what
/// the engine fills in, and what the `slavedTo ~= 0` a mount opens with needs.
#[test]
fn a_weapon_that_says_nothing_points_forward_and_is_slaved_to_nothing() {
    let def = serde_json::json!({
        "unitname": "mushroom",
        "weapons": { "1": { "name": "spray" } },
    });
    let names = pieces();
    let timeline = run(
        r#"
        function script.Create()
            local weapon = UnitDefs[unitDefID].weapons[1]
            if weapon.slavedTo ~= 0 then error("slavedTo is " .. tostring(weapon.slavedTo)) end
            Move(piece("turret"), z_axis, weapon.mainDirZ)
        end
        "#,
        "test.lua",
        &Unit {
            def: Some(&def),
            ..Unit::new(&names)
        },
        &create(),
        3,
        &HashMap::new(),
    );

    assert_eq!(timeline.error, None);
    assert_close(pose(&timeline, 0, "turret")[2], 1.0);
}

/// A script stores a rules parameter and reads it back, which is why the preview
/// keeps them rather than dropping them. One name means two values, because the
/// unit's store and the game's are separate in the engine, and a parameter
/// nobody set still reads as nothing.
#[test]
fn a_rules_parameter_reads_back_as_it_was_set() {
    let timeline = play(
        r#"
        function script.Create()
            Spring.SetUnitRulesParam(unitID, "grown", 3)
            Spring.SetGameRulesParam("grown", "4")
            if Spring.GetUnitRulesParam(unitID, "never") ~= nil then
                error("a parameter nobody set should read as nothing")
            end
            local mine = Spring.GetUnitRulesParam(unitID, "grown")
            local theirs = Spring.GetGameRulesParam("grown")
            Move(piece("turret"), z_axis, mine + theirs)
        end
        "#,
        3,
    );

    assert_eq!(timeline.error, None);
    // Three, plus the four that was stored as text and comes back as a number.
    assert_close(pose(&timeline, 0, "turret")[2], 7.0);
}

/// A rules param stores a number as a float, which only holds a whole number
/// exactly up to 2^24. A packed map position is usually bigger than that, so a
/// value beyond the exact range must come back rounded the way the engine's
/// float would round it, and the boundary itself must not round at all.
#[test]
fn a_large_rules_parameter_rounds_through_a_float_the_way_the_engine_does() {
    let timeline = play(
        r#"
        function script.Create()
            Spring.SetGameRulesParam("big", 196609234)
            Spring.SetGameRulesParam("small", 16777216)
            Move(piece("turret"), y_axis, Spring.GetGameRulesParam("big"))
            Move(piece("turret"), z_axis, Spring.GetGameRulesParam("small"))
        end
        "#,
        3,
    );

    assert_eq!(timeline.error, None);
    assert_close(pose(&timeline, 0, "turret")[1], 196609232.0);
    assert_close(pose(&timeline, 0, "turret")[2], 16777216.0);
}

/// The engine's GetRulesParam answers no values at all for a parameter
/// nobody set, not an explicit nil. `~= nil` cannot tell the two apart, but
/// `select("#", ...)` can, and a script passing the answer straight to
/// tonumber() without checking first is a script whose thread stops here.
#[test]
fn a_missing_rules_parameter_answers_no_values_rather_than_nil() {
    let timeline = play(
        r##"
        function script.Create()
            if select("#", Spring.GetGameRulesParam("never")) ~= 0 then
                error("a parameter nobody set should answer no values")
            end
            Move(piece("turret"), y_axis, 1)
        end
        "##,
        3,
    );

    assert_eq!(timeline.error, None);
    assert_close(pose(&timeline, 0, "turret")[1], 1.0);
}

/// The mistake `a_missing_rules_parameter_answers_no_values_rather_than_nil`
/// guards against: a BOS `get` of a shared value nobody has `set` yet reads it
/// through tonumber() with no values to convert, which is a Lua error, not 0.
#[test]
fn tonumber_of_a_missing_rules_parameter_stops_the_thread() {
    let timeline = play(
        r#"
        function script.Create()
            local value = tonumber(Spring.GetGameRulesParam("never"))
        end
        "#,
        3,
    );

    assert_eq!(timeline.error, None);
    assert!(
        timeline
            .warnings
            .iter()
            .any(|note| note.contains("tonumber")),
        "{:?}",
        timeline.warnings
    );
}

/// What flove's flowers open with. None of it can move a piece, but a preview
/// that stops on any of it shows nothing at all.
#[test]
fn the_world_calls_a_flower_opens_with_do_not_stop_it() {
    let timeline = play(
        r#"
        function script.Create()
            Spring.SetUnitCollisionVolumeData(unitID, 0, 0, 0, 0, 0, 0, -1, 0, 0)
            Spring.PlaySoundFile("bloom.wav")
            if Spring.CreateUnit("flower", 0, 0, 0, 0, 0) ~= nil then
                error("the preview has no second unit to make")
            end
            Move(piece("turret"), z_axis, Spring.GetUnitTeam(unitID) + 5)
        end
        "#,
        3,
    );

    assert_eq!(timeline.error, None);
    assert_close(pose(&timeline, 0, "turret")[2], 5.0);
}

/// A definition that gives only the older `maxvelocity`, which counts per frame
/// where `speed` counts per second. Every flove unit is written that way, and
/// reading past it played the walk cycle twenty times too slowly.
#[test]
fn the_move_type_falls_back_to_the_definitions_max_velocity() {
    let def = serde_json::json!({ "maxvelocity": 20.0 });
    let names = pieces();
    let timeline = run(
        r#"
        function script.Create()
            local data = Spring.GetUnitMoveTypeData(unitID)
            Move(piece("turret"), z_axis, data.maxSpeed / 30)
        end
        "#,
        "test.lua",
        &Unit {
            def: Some(&def),
            ..Unit::new(&names)
        },
        &create(),
        3,
        &HashMap::new(),
    );

    assert_eq!(timeline.error, None);
    assert_close(pose(&timeline, 0, "turret")[2], 20.0);
}

/// Scripts work out how fast to play a walk cycle from the unit's top speed, so
/// the preview has to answer with the definition's own rather than a zero they
/// would divide by.
#[test]
fn the_move_type_reports_the_speed_the_definition_gives() {
    let def = serde_json::json!({ "speed": 60.0 });
    let names = pieces();
    let timeline = run(
        r#"
        function script.Create()
            local data = Spring.GetUnitMoveTypeData(unitID)
            Turn(piece("turret"), y_axis, data.maxSpeed / 30)
        end
        "#,
        "test.lua",
        &Unit {
            def: Some(&def),
            ..Unit::new(&names)
        },
        &create(),
        3,
        &HashMap::new(),
    );

    assert_eq!(timeline.error, None);
    assert_close(rot_y(&timeline, 0, "turret"), 2.0);
}

#[test]
fn a_signal_kills_the_thread_carrying_its_mask() {
    let timeline = run(
        r#"
        local turret = piece("turret")
        local SIG = 1
        local function sweep()
            SetSignalMask(SIG)
            while true do
                Turn(turret, y_axis, 1.0, 1.0)
                Sleep(2000)
            end
        end
        function script.Create() StartThread(sweep) end
        function script.StopMoving()
            Signal(SIG)
            Turn(turret, y_axis, 0, 4)
        end
        "#,
        "test.lua",
        &Unit::new(&pieces()),
        &[
            ScriptEvent {
                frame: 0,
                callin: "Create".to_string(),
                args: Vec::new(),
                ambient: false,
                world: None,
                engine: None,
            },
            ScriptEvent {
                frame: 10,
                callin: "StopMoving".to_string(),
                args: Vec::new(),
                ambient: false,
                world: None,
                engine: None,
            },
        ],
        60,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None);
    // Killed and turned back to rest, and nothing moved it again afterwards.
    assert_close(rot_y(&timeline, 20, "turret"), 0.0);
    assert_close(rot_y(&timeline, 59, "turret"), 0.0);
}

#[test]
fn hide_and_show_are_reported_only_when_used() {
    let plain = play("function script.Create() end", 3);
    assert!(plain.hidden.is_empty());

    let timeline = play(
        r#"
        local flare = piece("flare")
        function script.Create()
            Hide(flare)
            Sleep(100)
            Show(flare)
        end
        "#,
        10,
    );
    assert_eq!(timeline.error, None);
    let flare = timeline
        .pieces
        .iter()
        .position(|name| name == "flare")
        .unwrap();
    assert!(timeline.hidden[0][flare]);
    assert!(!timeline.hidden[9][flare]);
}

#[test]
fn a_call_in_with_arguments_gets_them() {
    let timeline = run(
        r#"
        local turret = piece("turret")
        function script.AimWeapon1(heading, pitch)
            Turn(turret, y_axis, heading)
            return true
        end
        "#,
        "test.lua",
        &Unit::new(&pieces()),
        &[ScriptEvent {
            frame: 0,
            callin: "AimWeapon1".to_string(),
            args: vec![0.75, 0.1],
            ambient: false,
            world: None,
            engine: None,
        }],
        3,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None);
    assert_close(rot_y(&timeline, 0, "turret"), 0.75);
}

/// The shape coilbox's own generator writes: locals, a signal, a looping cycle
/// thread started from a call-in and stopped by a signal from another. If this
/// does not run, nothing a user takes ownership of will either.
#[test]
fn the_generated_script_shape_runs() {
    let timeline = run(
        r#"
        local base = piece("base")
        local turret = piece("turret")

        local SIG_WALK = 1

        local function walk()
          SetSignalMask(SIG_WALK)
          while true do
            Turn(turret, x_axis, 0.4363, 1.7452)
            Sleep(233)
            Turn(turret, x_axis, 0, 1.7452)
            Sleep(233)
            Turn(turret, x_axis, -0.4363, 1.7452)
            Sleep(233)
            Turn(turret, x_axis, 0, 1.7452)
            Sleep(233)
          end
        end

        local function walkStop()
          Turn(turret, x_axis, 0, 4)
        end

        function script.Create()
        end

        function script.StartMoving()
          StartThread(walk)
        end

        function script.StopMoving()
          Signal(SIG_WALK)
          walkStop()
        end

        function script.Killed(recentDamage, maxHealth)
          Explode(base, SFX.SHATTER)
          return 1
        end
        "#,
        "walker.lua",
        &Unit::new(&pieces()),
        &[
            ScriptEvent {
                frame: 0,
                callin: "Create".to_string(),
                args: Vec::new(),
                ambient: false,
                world: None,
                engine: None,
            },
            ScriptEvent {
                frame: 0,
                callin: "StartMoving".to_string(),
                args: Vec::new(),
                ambient: false,
                world: None,
                engine: None,
            },
            ScriptEvent {
                frame: 60,
                callin: "StopMoving".to_string(),
                args: Vec::new(),
                ambient: false,
                world: None,
                engine: None,
            },
        ],
        120,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None);
    assert_eq!(timeline.frames.len(), 120);

    // Walking: the turret is somewhere other than rest inside the first cycle.
    assert!(
        (1..30).any(|frame| rot_x(&timeline, frame, "turret").abs() > 0.01),
        "nothing moved while walking"
    );
    // Stopped: back to rest and staying there.
    assert_close(rot_x(&timeline, 119, "turret"), 0.0);
}

fn rot_x(timeline: &Timeline, frame: usize, piece: &str) -> f64 {
    let angle = pose(timeline, frame, piece)[3];
    // Reported in the engine's own range, so a small negative angle reads as
    // just under a full turn.
    if angle > std::f64::consts::PI {
        angle - TAU
    } else {
        angle
    }
}

#[test]
fn a_missing_piece_says_which_name() {
    let timeline = play(r#"local nope = piece("nope")"#, 10);
    let error = timeline.error.expect("naming a missing piece fails");
    assert!(error.contains("nope"), "{error}");
    assert!(timeline.frames.is_empty());
}

#[test]
fn a_syntax_error_says_where() {
    let timeline = play("function script.Create( end", 10);
    let error = timeline.error.expect("a syntax error fails");
    assert!(error.contains("test.lua"), "{error}");
}

/// The engine logs a thread that throws and the unit carries on, because a
/// unit is several threads and one of them being wrong is not the others being
/// wrong. BAR's commander runs a smoke thread, an idle thread and a walk thread
/// at once.
#[test]
fn a_throwing_call_in_stops_that_thread_and_nothing_else() {
    let timeline = run(
        r#"
        local turret = piece("turret")
        function script.Create() Turn(turret, y_axis, 1.0) end
        function script.StartMoving() error("no") end
        "#,
        "test.lua",
        &Unit::new(&pieces()),
        &[
            ScriptEvent {
                frame: 0,
                callin: "Create".to_string(),
                args: Vec::new(),
                ambient: false,
                world: None,
                engine: None,
            },
            ScriptEvent {
                frame: 5,
                callin: "StartMoving".to_string(),
                args: Vec::new(),
                ambient: false,
                world: None,
                engine: None,
            },
        ],
        30,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None);
    assert_eq!(timeline.frames.len(), 30);
    // The turn the working call-in started is still there afterwards.
    assert_close(rot_y(&timeline, 29, "turret"), 1.0);
    assert!(
        timeline
            .warnings
            .iter()
            .any(|note| note.contains("StartMoving")),
        "{:?}",
        timeline.warnings
    );
}

/// The two that are about the run rather than about one thread. Carrying on
/// past either is the hang each of them is there to prevent.
#[test]
fn a_frame_that_runs_out_of_instructions_still_stops_the_run() {
    let timeline = play("function script.Create() while true do end end", 30);

    let error = timeline.error.expect("an endless loop stops the run");
    assert!(error.contains("looping without a Sleep"), "{error}");
}

#[test]
fn a_loop_without_a_sleep_is_caught_rather_than_hanging() {
    let timeline = play(
        r#"
        function script.Create()
            while true do end
        end
        "#,
        30,
    );
    let error = timeline.error.expect("an endless loop fails");
    assert!(error.contains("looping without a Sleep"), "{error}");
}

#[test]
fn a_thread_started_every_frame_is_caught() {
    let timeline = play(
        r#"
        local function forever()
            while true do
                StartThread(forever)
                Sleep(33)
            end
        end
        function script.Create() StartThread(forever) end
        "#,
        200,
    );
    let error = timeline.error.expect("runaway threads fail");
    assert!(error.contains("threads running at once"), "{error}");
}

#[test]
fn a_call_in_the_script_does_not_have_is_a_warning_not_a_failure() {
    let timeline = run(
        "function script.Create() end",
        "test.lua",
        &Unit::new(&pieces()),
        &[ScriptEvent {
            frame: 0,
            callin: "StartMoving".to_string(),
            args: Vec::new(),
            ambient: false,
            world: None,
            engine: None,
        }],
        5,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None);
    assert_eq!(timeline.frames.len(), 5);
    assert!(
        timeline
            .warnings
            .iter()
            .any(|note| note.contains("StartMoving")),
        "{:?}",
        timeline.warnings
    );
}

#[test]
fn a_call_the_preview_cannot_honour_is_reported() {
    let timeline = play(
        r#"
        function script.Create() ChangeHeading(1.0) end
        "#,
        3,
    );
    assert_eq!(timeline.error, None);
    assert!(
        timeline
            .warnings
            .iter()
            .any(|note| note.contains("ChangeHeading")),
        "{:?}",
        timeline.warnings
    );
}

/// Every coilbox unit script with per-piece collision volumes opens with an
/// `include`, and the preview has no archive to read one out of. It must note
/// that and carry on: a script that will not play means no animation preview at
/// all, for a file that never moves a piece.
#[test]
fn a_script_that_includes_another_file_still_plays() {
    let timeline = play(
        r#"
        include("coilbox/thing_collision.lua")
        local flare = piece("flare")
        function script.Create() Turn(flare, y_axis, 1.0, 10.0) end
        "#,
        3,
    );
    assert_eq!(timeline.error, None);
    assert!(
        timeline
            .warnings
            .iter()
            .any(|note| note.contains("include")),
        "{:?}",
        timeline.warnings
    );
}

#[test]
fn the_frame_count_is_capped() {
    let timeline = play("function script.Create() end", MAX_FRAMES + 500);
    assert_eq!(timeline.frames.len(), MAX_FRAMES as usize);
}

#[test]
fn a_script_cannot_reach_outside_the_sandbox() {
    for hatch in ["loadstring", "dofile", "os", "io"] {
        // At the top level, where a failure is the script failing to load
        // rather than one of its threads failing.
        let timeline = play(&format!("{hatch}()"), 3);
        let error = timeline.error.expect("the sandbox holds");
        assert!(error.contains(hatch), "{error}");
    }
}

/// Asking a script which pieces it names, rather than watching what it moves.
/// This is the script's own answer about a piece's job, which is a stronger
/// thing than an inference drawn from motion.
mod probing {
    use super::*;

    fn ask(script: &str, callins: &[&str]) -> Probes {
        let names: Vec<String> = callins.iter().map(|c| (*c).to_string()).collect();
        probe(script, "test.lua", &Unit::new(&pieces()), &names)
    }

    fn answers<'a>(probes: &'a Probes, callin: &str) -> &'a Probe {
        probes
            .probes
            .iter()
            .find(|p| p.callin == callin)
            .expect("the probe was asked for")
    }

    #[test]
    fn reads_the_piece_a_call_in_returns() {
        let probes = ask(
            "local flare = piece('flare')\n\
             function script.QueryWeapon1() return flare end",
            &["QueryWeapon1"],
        );

        let probe = answers(&probes, "QueryWeapon1");
        assert_eq!(probe.pieces.first().map(String::as_str), Some("flare"));
        assert_eq!(probe.note, None);
    }

    /// A builder with several nozzles cycles them, so one call sees one of
    /// them. The whole cycle is what the caller is after.
    #[test]
    fn walks_a_cycle_round_by_calling_more_than_once() {
        let probes = ask(
            "local a, b = piece('turret'), piece('barrel')\n\
             local n = 0\n\
             function script.QueryNanoPiece()\n\
               n = n % 2 + 1\n\
               return ({a, b})[n]\n\
             end",
            &["QueryNanoPiece"],
        );

        let probe = answers(&probes, "QueryNanoPiece");
        let seen: std::collections::BTreeSet<&str> =
            probe.pieces.iter().map(String::as_str).collect();
        assert_eq!(
            seen,
            ["barrel", "turret"].into_iter().collect(),
            "{:?}",
            probe.pieces
        );
    }

    /// The preview tells a unit things it cannot work out for itself, such as
    /// what it is standing on. Almost no unit defines those call-ins, so
    /// reporting a missing one would report it about nearly every unit.
    #[test]
    fn stays_quiet_about_a_call_in_it_only_fired_to_describe_the_world() {
        let timeline = run(
            "function script.Create() end",
            "test.lua",
            &Unit::new(&pieces()),
            &[ScriptEvent {
                frame: 0,
                callin: "setSFXoccupy".to_string(),
                args: vec![4.0],
                ambient: true,
                world: None,
                engine: None,
            }],
            3,
            &HashMap::new(),
        );

        assert_eq!(timeline.warnings, Vec::<String>::new());
    }

    #[test]
    fn says_so_when_the_script_has_no_such_call_in() {
        let probes = ask("function script.Create() end", &["QueryNanoPiece"]);

        let probe = answers(&probes, "QueryNanoPiece");
        assert!(probe.pieces.is_empty());
        assert!(
            probe
                .note
                .as_deref()
                .unwrap_or("")
                .contains("QueryNanoPiece"),
            "{:?}",
            probe.note
        );
    }

    /// Usually a script written against a model this one is not, which is worth
    /// saying rather than quietly reporting no pieces.
    #[test]
    fn says_so_when_the_answer_is_not_a_piece_of_this_unit() {
        let probes = ask(
            "function script.QueryNanoPiece() return 99 end",
            &["QueryNanoPiece"],
        );

        let probe = answers(&probes, "QueryNanoPiece");
        assert!(probe.pieces.is_empty());
        assert!(probe.note.is_some(), "{probe:?}");
    }

    #[test]
    fn a_call_in_that_throws_stops_that_probe_and_says_why() {
        let probes = ask(
            "function script.QueryNanoPiece() error('nope') end",
            &["QueryNanoPiece"],
        );

        let probe = answers(&probes, "QueryNanoPiece");
        assert!(probe.pieces.is_empty());
        assert!(
            probe.note.as_deref().unwrap_or("").contains("nope"),
            "{:?}",
            probe.note
        );
    }

    /// One bad answer must not cost the others. A game script is asked several
    /// questions at once and usually answers some of them.
    #[test]
    fn one_failing_probe_does_not_stop_the_rest() {
        let probes = ask(
            "local flare = piece('flare')\n\
             function script.QueryNanoPiece() error('nope') end\n\
             function script.QueryWeapon1() return flare end",
            &["QueryNanoPiece", "QueryWeapon1"],
        );

        assert!(answers(&probes, "QueryNanoPiece").pieces.is_empty());
        assert_eq!(
            answers(&probes, "QueryWeapon1")
                .pieces
                .first()
                .map(String::as_str),
            Some("flare")
        );
    }

    #[test]
    fn a_script_that_will_not_load_reports_that_and_probes_nothing() {
        let probes = ask("this is not lua", &["QueryNanoPiece"]);

        assert!(probes.probes.is_empty());
        assert!(probes.error.is_some());
    }

    /// The probe calls a call-in directly rather than as a thread, so a script
    /// that tries to wait must come back as a failed probe rather than hanging.
    #[test]
    fn a_call_in_that_tries_to_wait_fails_rather_than_hanging() {
        let probes = ask(
            "local turret = piece('turret')\n\
             function script.QueryNanoPiece()\n\
               Sleep(100)\n\
               return turret\n\
             end",
            &["QueryNanoPiece"],
        );

        let probe = answers(&probes, "QueryNanoPiece");
        assert!(probe.note.is_some(), "{probe:?}");
    }
}

/// A unit script may read its own definition, and BAR's do. Without one the
/// script does not lose a branch, it throws on the line.
mod unit_definition {
    use super::*;

    fn with_def(script: &str, def: serde_json::Value) -> Timeline {
        let pieces = pieces();
        let unit = Unit {
            def: Some(&def),
            ..Unit::new(&pieces)
        };
        run(script, "test.lua", &unit, &create(), 3, &HashMap::new())
    }

    /// The exact line out of Beyond All Reason's `coralab.lua` that started
    /// this: `attempt to index global 'UnitDefs' (a nil value)`.
    #[test]
    fn lets_a_script_read_its_own_definition() {
        let timeline = with_def(
            r#"
            local lite = UnitDefs[unitDefID].customParams.litelab ~= nil
            local turret = piece("turret")
            function script.Create()
                Turn(turret, y_axis, lite and 1.0 or 0.5)
            end
            "#,
            serde_json::json!({ "customParams": { "litelab": "1" } }),
        );

        assert_eq!(timeline.error, None);
        assert!((rot_y(&timeline, 0, "turret") - 1.0).abs() < 1e-6);
    }

    /// A definition read out of a game comes back through its own def scripts,
    /// which lowercase every key, while the engine keeps the case. A script
    /// asking for `customParams` is asking for what is stored as
    /// `customparams`.
    #[test]
    fn finds_a_key_whatever_case_the_script_asks_in() {
        let timeline = with_def(
            r#"
            local lite = UnitDefs[unitDefID].customParams.liteLab ~= nil
            local turret = piece("turret")
            function script.Create()
                Turn(turret, y_axis, lite and 1.0 or 0.5)
            end
            "#,
            serde_json::json!({ "customparams": { "litelab": "1" } }),
        );

        assert_eq!(timeline.error, None);
        assert!((rot_y(&timeline, 0, "turret") - 1.0).abs() < 1e-6);
    }

    /// A key the definition does not carry is nothing, which is the answer, and
    /// the script takes the other branch rather than failing.
    #[test]
    fn answers_nothing_for_a_key_the_definition_does_not_have() {
        let timeline = with_def(
            r#"
            local lite = UnitDefs[unitDefID].customParams.litelab ~= nil
            local turret = piece("turret")
            function script.Create()
                Turn(turret, y_axis, lite and 1.0 or 0.5)
            end
            "#,
            serde_json::json!({ "customparams": { "techlevel": 2 } }),
        );

        assert_eq!(timeline.error, None);
        assert!((rot_y(&timeline, 0, "turret") - 0.5).abs() < 1e-6);
    }

    /// A unit built out of parts has no definition behind it. The script still
    /// runs, because throwing helps nobody, and the run says what was read so
    /// that a branch taken for want of an answer is not taken silently.
    #[test]
    fn says_when_a_unit_has_no_definition_to_read() {
        let timeline = run(
            r#"
            local lite = UnitDefs[unitDefID].customParams.litelab ~= nil
            function script.Create() end
            "#,
            "test.lua",
            &Unit::new(&pieces()),
            &create(),
            3,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        // The key the script actually wanted, which is the useful half: it
        // says which branch may have gone the way it did for want of an answer.
        assert!(
            timeline
                .warnings
                .iter()
                .any(|note| note.contains("litelab")),
            "{:?}",
            timeline.warnings
        );
    }

    /// A game reaches the same API through a `UnitScript` table as well as
    /// bare, and Beyond All Reason's scripts use both in one file.
    #[test]
    fn offers_the_api_under_the_table_a_script_may_reach_it_through() {
        let timeline = with_def(
            r#"
            local turret = piece("turret")
            function script.Create()
                UnitScript.Turn(turret, y_axis, 1.0)
            end
            "#,
            serde_json::json!({ "health": 1000 }),
        );

        assert_eq!(timeline.error, None);
        assert!((rot_y(&timeline, 0, "turret") - 1.0).abs() < 1e-6);
    }

    /// Zero-K's commanders scale their walk by another unit's speed. The
    /// preview only has this unit's own definition, so another one reads as
    /// empty and the script's own fallback applies, which is what it wrote the
    /// fallback for.
    #[test]
    fn reads_units_by_name_and_another_unit_as_empty() {
        let timeline = with_def(
            r#"
            local base = UnitDefNames.corcom1.speed or 37.5
            local own = UnitDefNames.corcom4.speed
            local turret = piece("turret")
            function script.Create()
                Turn(turret, y_axis, own / base)
                Turn(turret, x_axis, UnitDefs[unitDefID].name == "corcom4" and 1.0 or 0.5)
            end
            "#,
            serde_json::json!({ "unitname": "corcom4", "name": "Battle Commander", "speed": 75.0 }),
        );

        assert_eq!(timeline.error, None);
        assert!((rot_y(&timeline, 0, "turret") - 2.0).abs() < 1e-6);
        assert!(
            timeline
                .warnings
                .iter()
                .any(|note| note.contains("corcom1")),
            "{:?}",
            timeline.warnings
        );
    }

    /// The loop out of Zero-K's `corcom4.lua`. A def file names each weapon,
    /// here in slots 1, 5 and 6. The engine packs them into 1, 2 and 3 and
    /// hands the script a number to look up in `WeaponDefs`, whose `type` is
    /// the def file's `weapontype`. A weapon defined outside the unit still
    /// gets a number, which leads to its name.
    #[test]
    fn numbers_the_weapons_the_way_the_engine_does() {
        let timeline = with_def(
            r#"
            local starburst = {}
            local weapons = UnitDefs[unitDefID].weapons
            weapons.n = nil
            for index = 1, #weapons do
                local weaponDef = WeaponDefs[weapons[index].weaponDef]
                if weaponDef.type == "StarburstLauncher" then starburst[index] = true end
            end
            local turret = piece("turret")
            local barrel = piece("barrel")
            function script.Create()
                Turn(turret, y_axis, starburst[2] and 1.0 or 0.5)
                Turn(turret, x_axis, WeaponDefNames.corcom4_laser.description == "Laser" and 1.0 or 0.5)
                Turn(barrel, y_axis, WeaponDefs[weapons[3].weaponDef].name == "commweapon_shared" and 1.0 or 0.5)
            end
            "#,
            serde_json::json!({
                "unitname": "corcom4",
                "weapons": {
                    "1": { "name": "corcom4_laser" },
                    "5": { "name": "corcom4_missile" },
                    "6": { "name": "commweapon_shared" }
                },
                "weapondefs": {
                    "laser": { "weapontype": "BeamLaser", "name": "Laser" },
                    "missile": { "weapontype": "StarburstLauncher", "name": "Missile" }
                }
            }),
        );

        assert_eq!(timeline.error, None);
        assert!((rot_y(&timeline, 0, "turret") - 1.0).abs() < 1e-6);
        assert!((rot_x(&timeline, 0, "turret") - 1.0).abs() < 1e-6);
        assert!((rot_y(&timeline, 0, "barrel") - 1.0).abs() < 1e-6);
    }

    /// Every definition the engine builds carries a `customParams` table
    /// whether the game declared one or not, so the commonest thing a script
    /// reads is always there to read.
    #[test]
    fn always_has_a_custom_params_table_to_read() {
        let timeline = with_def(
            r#"
            local lite = UnitDefs[unitDefID].customParams.litelab ~= nil
            local turret = piece("turret")
            function script.Create()
                Turn(turret, y_axis, lite and 1.0 or 0.5)
            end
            "#,
            serde_json::json!({ "health": 1000 }),
        );

        assert_eq!(timeline.error, None);
        assert!((rot_y(&timeline, 0, "turret") - 0.5).abs() < 1e-6);
    }
}

/// A game may keep half its animation in a shared library and have every unit
/// pull it in, which is Beyond All Reason's house style. Without the library
/// the script stops on the first line that calls into it.
mod includes {
    use super::*;

    fn with_library(script: &str, name: &str, library: &str) -> Timeline {
        let mut sources = HashMap::new();
        sources.insert(name.to_string(), library.to_string());
        let pieces = pieces();
        let unit = Unit {
            includes: &sources,
            ..Unit::new(&pieces)
        };
        run(script, "test.lua", &unit, &create(), 3, &HashMap::new())
    }

    /// Zero-K's shape. The library fills the table the game's gadgets share,
    /// and reads it on its first line, so it needs that table to be there.
    #[test]
    fn a_library_fills_the_table_the_gadgets_share() {
        let timeline = with_library(
            r#"
            include "constants.lua"
            local turret = piece("turret")
            function script.Create() StartThread(GG.Script.Spin, turret) end
            "#,
            "constants.lua",
            r#"
            if GG.Script then return end
            GG.Script = {}
            function GG.Script.Spin(p) Turn(p, y_axis, 1.0) end
            "#,
        );

        assert_eq!(timeline.error, None);
        assert!((rot_y(&timeline, 0, "turret") - 1.0).abs() < 1e-6);
    }

    /// The shape of `coralab.lua`: a library defines the function, the script
    /// starts a thread on it, and without the file the thread starts on nil.
    #[test]
    fn runs_a_function_the_library_defines() {
        let timeline = with_library(
            r#"
            include("include/util.lua")
            local turret = piece("turret")
            function script.Create() StartThread(smoke_unit, turret) end
            "#,
            "include/util.lua",
            "function smoke_unit(piece) Turn(piece, y_axis, 1.0) end",
        );

        assert_eq!(timeline.error, None);
        assert!((rot_y(&timeline, 0, "turret") - 1.0).abs() < 1e-6);
    }

    /// SplinterFaction's shape: the library returns a table and the script
    /// keeps it, so what the chunk returns has to come back out of `include`.
    #[test]
    fn hands_back_what_the_library_returns() {
        let timeline = with_library(
            r#"
            local common = include("headers/common.lua")
            local turret = piece("turret")
            function script.Create() common.spin(turret) end
            "#,
            "headers/common.lua",
            "return { spin = function(p) Turn(p, y_axis, 1.0) end }",
        );

        assert_eq!(timeline.error, None);
        assert!((rot_y(&timeline, 0, "turret") - 1.0).abs() < 1e-6);
    }

    /// The name is matched the way the engine's VFS matches a path, because a
    /// script written on Windows names its library with backslashes.
    #[test]
    fn matches_a_name_whatever_its_case_and_separators() {
        let timeline = with_library(
            r#"
            include("Include\\Util.LUA")
            local turret = piece("turret")
            function script.Create() smoke_unit(turret) end
            "#,
            "include/util.lua",
            "function smoke_unit(piece) Turn(piece, y_axis, 1.0) end",
        );

        assert_eq!(timeline.error, None);
        assert!((rot_y(&timeline, 0, "turret") - 1.0).abs() < 1e-6);
    }

    /// A library the preview does not have is said rather than skipped in
    /// silence, because what follows is a script failing on a line that looks
    /// fine. Coilbox's own generated scripts pull in a collision file this way
    /// and get the same note, which is the honest answer: it is not applied.
    #[test]
    fn says_when_a_library_is_missing() {
        let timeline = run(
            r#"
            include("coilbox/armcom_collision.lua")
            function script.Create() end
            "#,
            "test.lua",
            &Unit::new(&pieces()),
            &create(),
            3,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert!(
            timeline
                .warnings
                .iter()
                .any(|note| note.contains("coilbox/armcom_collision.lua")),
            "{:?}",
            timeline.warnings
        );
    }

    /// The framework logs a library it cannot compile and carries on with
    /// nothing, so the script gets as far as the line that needed it.
    #[test]
    fn says_when_a_library_will_not_compile() {
        let timeline = with_library(
            r#"
            include("include/util.lua")
            function script.Create() end
            "#,
            "include/util.lua",
            "function broken( end",
        );

        assert_eq!(timeline.error, None);
        assert!(
            timeline
                .warnings
                .iter()
                .any(|note| note.contains("include/util.lua")
                    && note.contains("could not be loaded")),
            "{:?}",
            timeline.warnings
        );
    }

    /// A library that loads and then throws takes its caller with it, which is
    /// plain Lua and is what the framework does. The run says which file.
    #[test]
    fn a_library_that_throws_fails_the_run() {
        let timeline = with_library(
            r#"
            include("include/util.lua")
            function script.Create() end
            "#,
            "include/util.lua",
            "error('this library is unhappy')",
        );

        let error = timeline.error.expect("the run should have failed");
        assert!(error.contains("this library is unhappy"), "{error}");
    }
}

/// What a script is told when it asks the engine about its own unit. Absent
/// calls are not a lost branch, they are a script that stops on the line.
mod world {
    use super::*;

    fn with_def(script: &str, def: serde_json::Value) -> Timeline {
        let pieces = pieces();
        let unit = Unit {
            def: Some(&def),
            ..Unit::new(&pieces)
        };
        run(script, "test.lua", &unit, &create(), 6, &HashMap::new())
    }

    fn note_about(timeline: &Timeline, want: &str) -> bool {
        timeline.warnings.iter().any(|note| note.contains(want))
    }

    /// The first line of Beyond All Reason's shared library. Answering nothing
    /// is a script that waits to be finished for as long as the preview runs.
    #[test]
    fn a_unit_in_the_preview_is_finished_being_built() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                while Spring.GetUnitIsBeingBuilt(unitID) do Sleep(400) end
                Turn(turret, y_axis, 1.0)
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 1.0);
    }

    /// A factory asks for its yard to open and then waits for the yard to be
    /// open. Answering zero to the second is a wait that never ends, which is
    /// how a factory with a working script animates nothing.
    #[test]
    fn a_script_reads_back_a_value_it_set() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                SetUnitValue(COB.YARD_OPEN, 1)
                while GetUnitValue(COB.YARD_OPEN) == 0 do Sleep(1500) end
                Turn(turret, y_axis, 1.0)
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 1.0);
    }

    /// The engine takes either, and BAR's commander writes the boolean form.
    #[test]
    fn a_value_set_as_a_boolean_reads_back_as_a_number() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                UnitScript.SetUnitValue(COB.INBUILDSTANCE, true)
                Turn(turret, y_axis, UnitScript.GetUnitValue(COB.INBUILDSTANCE))
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 1.0);
    }

    /// The same answer the compiled runtime gives, because the two are being
    /// asked the same question by the same number.
    #[test]
    fn health_answers_what_a_finished_unit_would() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                Turn(turret, y_axis, GetUnitValue(COB.HEALTH) / 100)
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 1.0);
        assert!(timeline.warnings.is_empty(), "{:?}", timeline.warnings);
    }

    /// A `.cob` has no square root of its own and asks for one through the same
    /// call it asks questions with. The Lua runtime answers it identically, so
    /// that one id cannot mean two things across the two runtimes.
    #[test]
    fn the_maths_call_outs_are_answered_exactly() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                Turn(turret, y_axis, GetUnitValue(133, -1) + GetUnitValue(131, 2, 5))
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        // The absolute value of minus one, plus the smaller of two and five.
        assert_close(rot_y(&timeline, 0, "turret"), 3.0);
        assert!(timeline.warnings.is_empty(), "{:?}", timeline.warnings);
    }

    /// Every script passes it to everything it asks, and a script building a
    /// message out of it fails on the concatenation without it.
    #[test]
    fn the_unit_has_an_id_of_its_own() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                Turn(turret, y_axis, unitID)
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 1.0);
    }

    /// A question about the world is zero and says so, because a script handed
    /// zero for another unit's position quietly concludes it is at sea level.
    /// The ground itself is flat with no scene needed, so this asks about
    /// another unit instead, which does need one.
    #[test]
    fn a_question_about_the_world_says_there_is_none() {
        let timeline = play(
            "function script.Create() GetUnitValue(COB.UNIT_XZ, 5) end",
            3,
        );

        assert_eq!(timeline.error, None);
        assert!(
            note_about(&timeline, "no world to ask"),
            "{:?}",
            timeline.warnings
        );
    }

    /// The engine stopped keeping shared values in Spring 102.0, so a script
    /// that sets one and reads it back gets 0 in the game. A preview that
    /// handed the number back would show a script working that does not.
    #[test]
    fn a_shared_value_reads_zero_as_the_engine_answers() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                SetUnitValue(2048, 5)
                Turn(turret, y_axis, GetUnitValue(2048))
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 0.0);
        assert!(
            note_about(&timeline, "the engine no longer keeps shared values"),
            "{:?}",
            timeline.warnings
        );
    }

    /// The preview has one unit, 1, on team 0 in allyteam 0. A rules param or a
    /// question about any other unit or team finds nothing, as it would for a
    /// unit or team that does not exist. Each check adds its own bit, so a
    /// wrong total says which one failed.
    #[test]
    fn rules_params_and_teams_belong_to_the_one_unit() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                Spring.SetUnitRulesParam(unitID, "mine", 1, { allied = true })
                Spring.SetUnitRulesParam(unitID + 1, "mine", 10)
                Spring.SetTeamRulesParam(0, "ours", 2, { allied = true })
                Spring.SetTeamRulesParam(1, "ours", 20)
                local total = Spring.GetUnitRulesParam(unitID, "mine") + Spring.GetTeamRulesParam(0, "ours")
                if Spring.GetUnitRulesParam(unitID + 1, "mine") == nil and Spring.GetTeamRulesParam(1, "ours") == nil then
                    total = total + 4
                end
                if Spring.ValidUnitID(unitID) and not Spring.ValidUnitID(unitID + 1) then
                    total = total + 8
                end
                if Spring.GetTeamList(Spring.GetUnitAllyTeam(unitID))[1] == 0 and Spring.GetTeamList(1) == nil then
                    total = total + 16
                end
                if Spring.GetTeamInfo(0) == 0 and Spring.GetTeamInfo(1) == nil then
                    total = total + 32
                end
                Move(turret, y_axis, total)
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "turret")[1], 63.0);
    }

    /// The fourth value is the speed, and BAR's commander divides its walk
    /// cycle by it, so a unit answering nothing there never takes a step.
    #[test]
    fn velocity_is_the_speed_the_unit_was_built_for() {
        let timeline = with_def(
            r#"
            local turret = piece("turret")
            function script.Create()
                local vx, vy, vz, speed = Spring.GetUnitVelocity(unitID)
                Turn(turret, y_axis, speed)
            end
            "#,
            serde_json::json!({ "speed": 30.0 }),
        );

        assert_eq!(timeline.error, None);
        // Thirty elmos a second is one a frame, which is what the engine's own
        // velocity counts in.
        assert_close(rot_y(&timeline, 0, "turret"), 1.0);
    }

    /// A unit built out of parts has no definition to read a speed off, and the
    /// compiled runtime answers one elmo a frame when it is asked without one.
    #[test]
    fn a_unit_with_no_definition_still_moves_at_a_speed() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                local _, _, _, speed = Spring.GetUnitVelocity(unitID)
                Turn(turret, y_axis, speed)
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 1.0);
    }

    /// `UnitDefs[Spring.GetUnitDefID(unitID)]` is how a script reaches its own
    /// definition, and it is what stops BAR's commander before anything else.
    #[test]
    fn the_definition_id_finds_the_units_own_definition() {
        let timeline = with_def(
            r#"
            local turret = piece("turret")
            function script.Create()
                Turn(turret, y_axis, UnitDefs[Spring.GetUnitDefID(unitID)].speed / 30)
            end
            "#,
            serde_json::json!({ "speed": 30.0 }),
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 1.0);
    }

    #[test]
    fn the_game_frame_is_the_frame_the_run_is_on() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                Sleep(100)
                Turn(turret, y_axis, Spring.GetGameFrame())
            end
            "#,
            8,
        );

        assert_eq!(timeline.error, None);
        // Three frames of sleep, so it turns to 3 on the frame it wakes.
        assert_close(rot_y(&timeline, 3, "turret"), 3.0);
    }

    /// BAR calls `Spring.UnitScript.EmitSfx` and SplinterFaction calls
    /// `Spring.UnitScript.Spin`, both meaning what they already have in scope.
    #[test]
    fn the_api_is_also_under_the_spring_table() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create() Spring.UnitScript.Turn(turret, y_axis, 1.0) end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 1.0);
    }

    /// An emit id is a number a script does arithmetic on, so a missing name is
    /// not a lost effect, it is adding three to nothing. BAR's commander asks
    /// for exactly this.
    #[test]
    fn the_emit_effects_are_named_as_well_as_the_explode_flags() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create() EmitSfx(turret, SFX.CEG + 3) end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
    }

    /// A script telling you what it is doing is worth showing, and it is the
    /// most used call in BAR's scripts by a distance.
    #[test]
    fn what_a_script_prints_is_reported() {
        let timeline = play(
            r#"function script.Create() Spring.Echo("opening the yard") end"#,
            3,
        );

        assert!(
            note_about(&timeline, "opening the yard"),
            "{:?}",
            timeline.warnings
        );
    }

    /// A script printing every frame would leave no room for anything else the
    /// run has to say.
    #[test]
    fn a_script_that_prints_without_stopping_is_cut_off() {
        let timeline = play(
            r#"
            function script.Create()
                for i = 1, 50 do Spring.Echo("line " .. i) end
            end
            "#,
            3,
        );

        assert!(timeline.warnings.len() < 20, "{:?}", timeline.warnings);
        assert!(
            note_about(&timeline, "the rest was dropped"),
            "{:?}",
            timeline.warnings
        );
    }

    /// The preview has no world to place the unit in, so a script deciding
    /// something from where it is decides it as though it were at the origin.
    /// It still runs, and the note says why the branch went the way it did.
    #[test]
    fn a_position_answers_the_origin_and_says_so() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                local _, y, _ = Spring.GetUnitPosition(unitID)
                Turn(turret, y_axis, y + 1)
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 1.0);
        assert!(
            note_about(&timeline, "answers the origin"),
            "{:?}",
            timeline.warnings
        );
    }

    /// A commander checks whether a foot is under water by adding the piece's
    /// height to the unit's, so the height has to come from the model. Every
    /// piece at zero is a unit at sea level with all of itself submerged.
    #[test]
    fn a_piece_is_where_the_model_puts_it() {
        // The turret ten above the base, the barrel two above that.
        let rest = [
            Rest {
                parent: None,
                position: [0.0, 0.0, 0.0],
            },
            Rest {
                parent: Some(0),
                position: [0.0, 10.0, 0.0],
            },
            Rest {
                parent: Some(1),
                position: [0.0, 2.0, 0.0],
            },
            Rest::default(),
        ];
        let pieces = pieces();
        let timeline = run(
            r#"
            local turret = piece("turret")
            local barrel = piece("barrel")
            function script.Create()
                local _, y, _ = Spring.GetUnitPiecePosition(unitID, barrel)
                -- Moved rather than turned, because a rotation is reported
                -- inside one turn and twelve radians is nearly two.
                Move(turret, z_axis, y)
            end
            "#,
            "test.lua",
            &Unit {
                rest: &rest,
                ..Unit::new(&pieces)
            },
            &create(),
            3,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "turret")[2], 12.0);
    }

    /// The engine hands `GetUnitValue` its piece argument untouched
    /// (`LuaUnitScript.cpp:1262-1286`), so it counts from 0 where every other
    /// piece a Lua script names counts from 1. bos2lua writes `turret - 1` for
    /// exactly this reason.
    #[test]
    fn answers_where_a_piece_is_counting_from_zero() {
        let rest = [
            Rest {
                parent: None,
                position: [0.0, 0.0, 0.0],
            },
            Rest {
                parent: Some(0),
                position: [3.0, 7.0, 5.0],
            },
            Rest::default(),
            Rest::default(),
        ];
        let pieces = pieces();
        let timeline = run(
            r#"
            local turret = piece("turret")
            local barrel = piece("barrel")
            function script.Create()
                local y = GetUnitValue(COB.PIECE_Y, turret - 1)
                local xz = GetUnitValue(COB.PIECE_XZ, turret - 1)
                Move(barrel, y_axis, y / 65536)
                Move(barrel, z_axis, xz)
            end
            "#,
            "test.lua",
            &Unit {
                rest: &rest,
                ..Unit::new(&pieces)
            },
            &create(),
            3,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "barrel")[1], 7.0);
        assert_close(
            pose(&timeline, 0, "barrel")[2],
            f64::from(unitvalue::pack_xz(3.0, 5.0)),
        );
        assert!(
            !timeline
                .warnings
                .iter()
                .any(|note| note.contains("the world")),
            "{:?}",
            timeline.warnings
        );
    }

    /// The maths on a packed pair, answered as the compiled runtime answers it.
    #[test]
    fn measures_a_packed_pair_as_the_compiled_runtime_does() {
        let timeline = play(
            r#"
            local base = piece("base")
            function script.Create()
                local far = GetUnitValue(COB.XZ_HYPOT, (3 * 65536) + 4)
                Move(base, z_axis, far / 65536)
            end
            "#,
            2,
        );

        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "base")[2], 5.0);
    }

    /// One walk cycle shared between units built from different models, which
    /// is what the piece map is for. A name the unit does not have must read as
    /// nothing, so that asking is safe.
    #[test]
    fn the_piece_map_numbers_pieces_the_way_piece_does() {
        let timeline = play(
            r#"
            function script.Create()
                local pieces = Spring.GetUnitPieceMap(unitID)
                if pieces.turret ~= piece("turret") then error("numbering disagrees") end
                if pieces.nostril ~= nil then error("found a piece this unit has not got") end
                Turn(piece("turret"), y_axis, pieces.turret)
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        // The unit is base, turret, barrel, flare, so turret is the second.
        assert_close(rot_y(&timeline, 0, "turret"), 2.0);
    }

    /// The spelling problem `piece()` already has. A unit opened out of a game
    /// carries lower case piece names while the game's own script asks for the
    /// spelling its model file uses, and flove's `Trunk` is where that showed.
    #[test]
    fn the_piece_map_answers_whatever_case_the_script_asks_in() {
        let timeline = play(
            r#"
            function script.Create()
                local pieces = Spring.GetUnitPieceMap(unitID)
                Turn(piece("turret"), y_axis, pieces.Turret)
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 2.0);
    }

    /// A unit nobody said the shape of. Answering the origin in silence would
    /// have a script decide its pieces are all at the unit's feet.
    #[test]
    fn a_piece_on_a_unit_with_no_geometry_says_so() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                local _, y, _ = Spring.GetUnitPiecePosition(unitID, turret)
                Turn(turret, y_axis, y + 1)
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 1.0);
        assert!(
            note_about(&timeline, "where this unit's pieces sit"),
            "{:?}",
            timeline.warnings
        );
    }

    fn scene(pos: Option<[f64; 3]>) -> coilbox_unitpose::World {
        coilbox_unitpose::World {
            stand_in: Some(coilbox_unitpose::StandIn {
                id: 2,
                pos,
                radius: 28.0,
                height: 30.8,
            }),
            own: coilbox_unitpose::Size {
                radius: 60.0,
                height: 40.0,
            },
        }
    }

    fn pickup(script: &str, world: Option<coilbox_unitpose::World>) -> Timeline {
        run(
            script,
            "test.lua",
            &Unit::new(&pieces()),
            &[ScriptEvent {
                frame: 0,
                callin: "TransportPickup".to_string(),
                args: vec![2.0],
                ambient: false,
                world,
                engine: None,
            }],
            2,
            &HashMap::new(),
        )
    }

    /// The same question a converted BOS script asks, answered the same way.
    #[test]
    fn tells_a_transport_by_unit_value_where_its_passenger_is() {
        let timeline = pickup(
            r#"
            local base = piece("base")
            function script.TransportPickup(passenger)
                Move(base, z_axis, GetUnitValue(COB.UNIT_Y, passenger) / 65536)
            end
            "#,
            Some(scene(Some([0.0, 3.0, 84.0]))),
        );
        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "base")[2], 3.0);
    }

    /// How a Lua transport asks, which is SplinterFaction's
    /// `lozdragonfly_lus.lua` on its first line.
    #[test]
    fn tells_a_transport_by_spring_call_where_and_how_big_its_passenger_is() {
        let timeline = pickup(
            r#"
            local base = piece("base")
            local turret = piece("turret")
            local barrel = piece("barrel")
            function script.TransportPickup(passenger)
                local _, _, z = Spring.GetUnitPosition(passenger)
                Move(base, z_axis, z)
                Move(turret, z_axis, Spring.GetUnitHeight(passenger))
                Move(barrel, z_axis, Spring.GetUnitRadius(passenger))
            end
            "#,
            Some(scene(Some([0.0, 3.0, 84.0]))),
        );
        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "base")[2], 84.0);
        assert_close(pose(&timeline, 0, "turret")[2], 30.8);
        assert_close(pose(&timeline, 0, "barrel")[2], 28.0);
    }

    /// The engine hands back nothing for a unit that does not exist.
    #[test]
    fn a_unit_that_is_not_there_has_no_position_or_size() {
        let timeline = pickup(
            r#"
            function script.TransportPickup(passenger)
                if Spring.GetUnitPosition(7) ~= nil then error("found a unit") end
                if Spring.GetUnitHeight(7) ~= nil then error("sized a unit") end
            end
            "#,
            Some(scene(Some([0.0, 3.0, 84.0]))),
        );
        assert_eq!(timeline.error, None);
        assert!(
            !timeline
                .warnings
                .iter()
                .any(|note| note.contains("stopped")),
            "{:?}",
            timeline.warnings
        );
    }

    /// Its own position is still the origin, as it was before there was a
    /// scene.
    #[test]
    fn the_unit_itself_is_still_at_the_origin() {
        let timeline = pickup(
            r#"
            local base = piece("base")
            function script.TransportPickup(passenger)
                local x, y, z = Spring.GetUnitPosition(unitID)
                Move(base, z_axis, x + y + z + Spring.GetUnitRadius(unitID))
            end
            "#,
            Some(scene(Some([0.0, 3.0, 84.0]))),
        );
        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "base")[2], 60.0);
    }
}

/// What a caller offering controls for a script's own unit values, or a way to
/// fire any function it defines, has to run the script once to learn: which
/// ids it reads, what a supplied seed looks like once it gets there, and what
/// its own functions are called.
mod unit_values_and_functions {
    use super::*;

    /// Reported by name, in the order the script first asked, the same as the
    /// compiled runtime reports them.
    #[test]
    fn reading_two_values_reports_both_by_name() {
        let timeline = play(
            r#"
            function script.Create()
                local health = GetUnitValue(COB.HEALTH)
                local activation = GetUnitValue(COB.ACTIVATION)
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        let names: Vec<Option<&str>> = timeline
            .asked
            .iter()
            .map(|value| value.name.as_deref())
            .collect();
        assert_eq!(names, vec![Some("HEALTH"), Some("ACTIVATION")]);
    }

    /// A caller's seed is what the script sees, in place of the answer a
    /// finished unit would otherwise give it, the same as a script's own
    /// `SetUnitValue` would be if it had already run.
    #[test]
    fn a_supplied_value_is_what_the_script_sees() {
        let health = unitvalue::NAMES
            .iter()
            .find(|(name, _)| *name == "HEALTH")
            .unwrap()
            .1;
        let mut values = HashMap::new();
        values.insert(health, 5);

        let timeline = play_with_values(
            r#"
            local turret = piece("turret")
            function script.Create()
                Turn(turret, y_axis, GetUnitValue(COB.HEALTH) / 100)
            end
            "#,
            3,
            &values,
        );

        assert_eq!(timeline.error, None);
        // A finished unit with no seed would answer 100 here, and turn by 1.0.
        assert_close(rot_y(&timeline, 0, "turret"), 0.05);
    }

    /// The script's own function names, which is what a caller offering "call
    /// any function" has to run the script once to learn. Sorted, since a Lua
    /// table's own order is not one.
    #[test]
    fn functions_lists_the_scripts_own_table_keys() {
        let timeline = play(
            r#"
            function script.Create() end
            function script.Restore() end
            function script.QueryTurret() end
            "#,
            1,
        );

        assert_eq!(timeline.error, None);
        assert_eq!(timeline.functions, vec!["Create", "QueryTurret", "Restore"]);
    }

    /// The engine reaches a script's own functions by name off the `script`
    /// table, exactly as it reaches a call-in such as `AimWeapon1`. An event
    /// naming one of the script's own functions has to fire it the same way,
    /// not just the call-ins the engine defines.
    #[test]
    fn an_event_fires_a_function_the_script_defines_for_its_own_reasons() {
        let events = vec![ScriptEvent {
            frame: 0,
            callin: "DoTheThing".to_string(),
            args: Vec::new(),
            ambient: false,
            world: None,
            engine: None,
        }];
        let timeline = run(
            r#"
            local turret = piece("turret")
            function script.DoTheThing()
                Turn(turret, y_axis, 1.0)
            end
            "#,
            "test.lua",
            &Unit::new(&pieces()),
            &events,
            3,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 1.0);
    }
}

mod coverage {
    use super::*;

    /// A branch never taken never lights up: the Script tab dims a line the
    /// run could have reached but did not, and that has to mean the branch
    /// actually not run, not every line the parser saw.
    #[test]
    fn a_branch_not_taken_is_not_among_the_lines_run() {
        let script = r#"
            local turret = piece("turret")
            function script.Create()
                if false then
                    Turn(turret, y_axis, 1.0)
                else
                    Turn(turret, y_axis, 2.0)
                end
            end
            "#;
        let timeline = play(script, 3);

        assert_eq!(timeline.error, None);
        let line_of = |needle: &str| -> u32 {
            let at = script.find(needle).expect("needle is in the script");
            script[..at].matches('\n').count() as u32 + 1
        };
        let taken = line_of("Turn(turret, y_axis, 2.0)");
        let not_taken = line_of("Turn(turret, y_axis, 1.0)");

        assert!(
            timeline.lines_run.contains(&taken),
            "{:?}",
            timeline.lines_run
        );
        assert!(
            !timeline.lines_run.contains(&not_taken),
            "{:?}",
            timeline.lines_run
        );
    }

    /// A line an `include`d file runs is not a main script line, so it does not
    /// count toward the main script's coverage.
    #[test]
    fn a_line_run_inside_an_include_is_not_counted() {
        let mut includes = HashMap::new();
        includes.insert(
            "lib.lua".to_string(),
            "function helper() return 1 end\n".to_string(),
        );
        let script = r#"
            include("lib.lua")
            local turret = piece("turret")
            function script.Create()
                Turn(turret, y_axis, helper())
            end
            "#;
        let timeline = run(
            script,
            "test.lua",
            &Unit {
                includes: &includes,
                ..Unit::new(&pieces())
            },
            &create(),
            3,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        let line_of = |needle: &str| -> u32 {
            let at = script.find(needle).expect("needle is in the script");
            script[..at].matches('\n').count() as u32 + 1
        };
        // The include's own line 1 would collide with the main script's line 1
        // if the two were not told apart by chunk name.
        assert!(timeline.lines_run.contains(&line_of("Turn(turret")));
        assert!(!timeline.lines_run.is_empty());
    }
}

mod announcements {
    use super::*;
    use coilbox_unitpose::ScriptOutput;

    fn scene() -> coilbox_unitpose::World {
        coilbox_unitpose::World {
            stand_in: Some(coilbox_unitpose::StandIn {
                id: 2,
                pos: Some([30.0, 0.0, 40.0]),
                radius: 5.0,
                height: 6.0,
            }),
            own: coilbox_unitpose::Size {
                radius: 10.0,
                height: 12.0,
            },
        }
    }

    /// base at the origin, turret on it at (0, 10, 20), the rest at base.
    fn rest() -> Vec<Rest> {
        vec![
            Rest {
                parent: None,
                position: [0.0; 3],
            },
            Rest {
                parent: Some(0),
                position: [0.0, 10.0, 20.0],
            },
            Rest {
                parent: Some(0),
                position: [0.0; 3],
            },
            Rest {
                parent: Some(0),
                position: [0.0; 3],
            },
        ]
    }

    fn pickup(script: &str, frames: u32) -> Timeline {
        let names = pieces();
        let rest = rest();
        run(
            script,
            "test.lua",
            &Unit {
                rest: &rest,
                ..Unit::new(&names)
            },
            &[ScriptEvent {
                frame: 0,
                callin: "TransportPickup".to_string(),
                args: vec![2.0],
                ambient: false,
                world: Some(scene()),
                engine: None,
            }],
            frames,
            &HashMap::new(),
        )
    }

    #[test]
    fn records_effects_and_sound_with_pieces_counted_from_one() {
        let timeline = play(
            r#"
            local turret, flare = piece("turret", "flare")
            function script.Create()
                EmitSfx(flare, 1025)
                Explode(turret, SFX.SHATTER)
                PlaySoundFile("krogtaunt")
                Spring.PlaySoundFile("sounds/krogdeath.wav", 1)
            end
            "#,
            2,
        );

        assert_eq!(timeline.error, None);
        assert_eq!(
            timeline.events,
            [
                ScriptOutput::Sfx {
                    frame: 0,
                    piece: "flare".to_string(),
                    sfx: 1025
                },
                ScriptOutput::Explode {
                    frame: 0,
                    piece: "turret".to_string(),
                    flags: 1
                },
                ScriptOutput::Sound {
                    frame: 0,
                    name: Some("krogtaunt".to_string())
                },
                ScriptOutput::Sound {
                    frame: 0,
                    name: Some("sounds/krogdeath.wav".to_string())
                },
            ]
        );
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w == coilbox_unitpose::EFFECTS_NOTE));
        assert!(
            !timeline
                .warnings
                .iter()
                .any(|w| w.contains("does nothing in the preview")),
            "{:?}",
            timeline.warnings
        );
    }

    /// The engine reports a piece it does not have and carries on, so the
    /// thread keeps going rather than stopping on the line.
    #[test]
    fn a_piece_that_is_not_there_is_noted_and_the_thread_carries_on() {
        let timeline = play(
            r#"
            local base = piece("base")
            function script.Create()
                Explode(99, 1)
                Move(base, y_axis, 3)
            end
            "#,
            2,
        );

        assert_eq!(timeline.error, None);
        assert!(timeline.events.is_empty());
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w.contains("Explode names piece 99")));
        assert_close(pose(&timeline, 1, "base")[1], 3.0);
    }

    /// A generator named rather than numbered is marked global
    /// (`LuaUnitScript.cpp:1430`).
    #[test]
    fn an_effect_named_rather_than_numbered_is_marked_global() {
        let timeline = play(
            r#"
            local flare = piece("flare")
            function script.Create() EmitSfx(flare, "muzzleflash") end
            "#,
            2,
        );

        assert_eq!(
            timeline.events,
            [ScriptOutput::Sfx {
                frame: 0,
                piece: "flare".to_string(),
                sfx: 16384
            }]
        );
        assert!(timeline.warnings.iter().any(|w| w.contains("muzzleflash")));
    }

    /// Both spellings of the framework's call-outs record the same thing.
    #[test]
    fn attaches_to_a_piece_then_the_void_then_drops() {
        let timeline = pickup(
            r#"
            local turret = piece("turret")
            function script.TransportPickup(passenger)
                AttachUnit(turret, passenger)
                Spring.UnitScript.AttachUnit(0, passenger)
                UnitScript.DropUnit(passenger)
            end
            "#,
            2,
        );

        assert_eq!(timeline.error, None);
        assert_eq!(
            timeline.events,
            [
                ScriptOutput::Attach {
                    frame: 0,
                    unit: 2,
                    piece: Some("turret".to_string())
                },
                ScriptOutput::Attach {
                    frame: 0,
                    unit: 2,
                    piece: None
                },
                ScriptOutput::Drop { frame: 0, unit: 2 },
            ]
        );
    }

    /// Shaped like `intruder.bos` `AreaUnload`: attach, then poll until the
    /// passenger is on the piece. It is not there on the attach's own frame,
    /// because the engine moves passengers after every script has ticked, and
    /// it is there one poll later. After a drop, moving the piece leaves the
    /// passenger behind.
    #[test]
    fn a_passenger_reaches_its_piece_after_the_frame_it_was_attached() {
        let timeline = pickup(
            r#"
            local base, turret, barrel = piece("base", "turret", "barrel")
            function script.TransportPickup(passenger)
                AttachUnit(turret, passenger)
                local polls = 1
                while GetUnitValue(COB.UNIT_XZ, passenger) ~= GetUnitValue(COB.PIECE_XZ, turret - 1) do
                    polls = polls + 1
                    Sleep(100)
                end
                Move(base, y_axis, polls)
                local held = GetUnitValue(COB.PIECE_XZ, turret - 1)
                DropUnit(passenger)
                Move(turret, x_axis, 50)
                Sleep(100)
                if GetUnitValue(COB.UNIT_XZ, passenger) ~= GetUnitValue(COB.PIECE_XZ, turret - 1) then
                    Move(barrel, y_axis, 1)
                end
                if GetUnitValue(COB.UNIT_XZ, passenger) == held then
                    Move(barrel, z_axis, 1)
                end
            end
            "#,
            20,
        );

        assert_eq!(timeline.error, None);
        // 1 would mean the attach moved the stand-in at once. 0 would mean it
        // never reached the piece.
        assert_close(pose(&timeline, 19, "base")[1], 2.0);
        assert_close(pose(&timeline, 19, "barrel")[1], 1.0);
        assert_close(pose(&timeline, 19, "barrel")[2], 1.0);
    }

    /// Lua's own way of asking gets the same answer.
    #[test]
    fn spring_says_a_carried_passenger_is_on_its_piece() {
        let timeline = pickup(
            r#"
            local base, turret = piece("base", "turret")
            function script.TransportPickup(passenger)
                AttachUnit(turret, passenger)
                Sleep(33)
                local x, y, z = Spring.GetUnitPosition(passenger)
                Move(base, x_axis, x)
                Move(base, y_axis, y)
                Move(base, z_axis, z)
            end
            "#,
            4,
        );

        assert_eq!(timeline.error, None);
        let base = pose(&timeline, 3, "base");
        assert_close(base[0], 0.0);
        assert_close(base[1], 10.0);
        assert_close(base[2], 20.0);
    }
}

mod engine_attach {
    use super::*;
    use coilbox_unitpose::ScriptOutput;

    fn scene() -> coilbox_unitpose::World {
        coilbox_unitpose::World {
            stand_in: Some(coilbox_unitpose::StandIn {
                id: 2,
                pos: Some([30.0, 0.0, 40.0]),
                radius: 5.0,
                height: 6.0,
            }),
            own: coilbox_unitpose::Size {
                radius: 10.0,
                height: 12.0,
            },
        }
    }

    fn engine(frame: u32, action: EngineAction) -> ScriptEvent {
        ScriptEvent {
            frame,
            callin: String::new(),
            args: Vec::new(),
            ambient: false,
            world: Some(scene()),
            engine: Some(action),
        }
    }

    fn carried(script: &str, events: &[ScriptEvent]) -> Timeline {
        run(
            script,
            "test.lua",
            &Unit::new(&pieces()),
            events,
            6,
            &HashMap::new(),
        )
    }

    #[test]
    fn asks_query_transport_with_the_passenger_s_id() {
        let timeline = carried(
            r#"
            local base, turret = piece("base", "turret")
            function script.QueryTransport(passenger)
                if passenger == 2 then return turret end
                return base
            end
            "#,
            &[engine(0, EngineAction::Attach)],
        );

        assert_eq!(timeline.error, None);
        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach {
                frame: 0,
                unit: 2,
                piece: Some("turret".to_string())
            }]
        );
    }

    /// `RunQueryCallIn` answers -1 when there is nothing to call
    /// (`LuaUnitScript.cpp:505-519`), which is the void.
    #[test]
    fn a_missing_query_transport_is_the_void() {
        let timeline = carried(
            "function script.Create() end",
            &[engine(0, EngineAction::Attach)],
        );

        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach {
                frame: 0,
                unit: 2,
                piece: None
            }]
        );
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w.contains("no QueryTransport")));
    }

    #[test]
    fn a_query_transport_that_fails_is_the_void() {
        let timeline = carried(
            r#"function script.QueryTransport() error("boom") end"#,
            &[engine(0, EngineAction::Attach)],
        );

        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach {
                frame: 0,
                unit: 2,
                piece: None
            }]
        );
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w.contains("QueryTransport failed")));
    }

    #[test]
    fn detaches_when_the_engine_says() {
        let timeline = carried(
            r#"
            local turret = piece("turret")
            function script.QueryTransport() return turret end
            "#,
            &[
                engine(0, EngineAction::Attach),
                engine(3, EngineAction::Detach),
            ],
        );

        assert_eq!(timeline.events[1], ScriptOutput::Drop { frame: 3, unit: 2 });
    }

    /// `BeginTransport` runs its first tick before `AttachUnit(QueryTransport(...))`
    /// asks, on a shared frame (`MobileCAI.cpp:1451-1453`, `CobInstance.cpp:593`).
    #[test]
    fn ticks_begin_transport_before_query_transport_reads_what_it_set() {
        let timeline = carried(
            r#"
            local base, turret = piece("base", "turret")
            local height
            function script.BeginTransport(passengerHeight)
                height = passengerHeight
            end
            function script.QueryTransport()
                if height then return turret end
                return base
            end
            "#,
            &[
                ScriptEvent {
                    frame: 0,
                    callin: "BeginTransport".to_string(),
                    args: vec![6.0],
                    ambient: false,
                    world: None,
                    engine: None,
                },
                engine(0, EngineAction::Attach),
            ],
        );

        assert_eq!(timeline.error, None);
        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach {
                frame: 0,
                unit: 2,
                piece: Some("turret".to_string())
            }]
        );
    }

    /// `TransportDrop` runs its first tick before the landing detach, on a
    /// shared frame (`MobileCAI.cpp:2090-2091`, `CobInstance.cpp:593`).
    #[test]
    fn ticks_transport_drop_before_the_detach_acts() {
        let timeline = carried(
            r#"
            local turret, barrel = piece("turret"), piece("barrel")
            function script.QueryTransport() return turret end
            function script.TransportDrop(passenger)
                Spring.UnitScript.AttachUnit(barrel, passenger)
            end
            "#,
            &[
                engine(0, EngineAction::Attach),
                ScriptEvent {
                    frame: 3,
                    callin: "TransportDrop".to_string(),
                    args: vec![2.0, 0.0, 0.0, 0.0],
                    ambient: false,
                    world: Some(scene()),
                    engine: None,
                },
                engine(3, EngineAction::Detach),
            ],
        );

        let on_frame_three: Vec<_> = timeline
            .events
            .iter()
            .filter(|event| {
                matches!(
                    event,
                    ScriptOutput::Attach { frame: 3, .. } | ScriptOutput::Drop { frame: 3, .. }
                )
            })
            .cloned()
            .collect();
        assert_eq!(
            on_frame_three,
            [
                ScriptOutput::Attach {
                    frame: 3,
                    unit: 2,
                    piece: Some("barrel".to_string())
                },
                ScriptOutput::Drop { frame: 3, unit: 2 },
            ]
        );
    }
}

mod engine_nano {
    use super::*;
    use coilbox_unitpose::ScriptOutput;

    fn action(frame: u32, action: EngineAction) -> ScriptEvent {
        ScriptEvent {
            frame,
            callin: String::new(),
            args: Vec::new(),
            ambient: false,
            world: None,
            engine: Some(action),
        }
    }

    fn sprayed(script: &str, frames: u32, start: u32, stop: u32) -> Timeline {
        run(
            script,
            "test.lua",
            &Unit::new(&pieces()),
            &[
                action(start, EngineAction::NanoStart),
                action(stop, EngineAction::NanoStop),
            ],
            frames,
            &HashMap::new(),
        )
    }

    fn nano(timeline: &Timeline) -> Vec<(u32, Option<String>)> {
        timeline
            .events
            .iter()
            .filter_map(|event| match event {
                ScriptOutput::Nano { frame, piece } => Some((*frame, piece.clone())),
                _ => None,
            })
            .collect()
    }

    /// The same answers as the compiled runtime's `alternating` script.
    #[test]
    fn sprays_from_what_query_nano_piece_answers_on_each_frame_between_start_and_stop() {
        let timeline = sprayed(
            r#"
            local turret, barrel = piece("turret", "barrel")
            local flip = 0
            function script.QueryNanoPiece()
                flip = 1 - flip
                if flip == 1 then return barrel end
                return turret
            end
            "#,
            8,
            2,
            6,
        );

        assert_eq!(timeline.error, None);
        assert_eq!(
            nano(&timeline),
            [
                (2, Some("barrel".to_string())),
                (3, Some("turret".to_string())),
                (4, Some("barrel".to_string())),
                (5, Some("turret".to_string())),
            ]
        );
    }

    /// `RunQueryCallIn` answers -1 when there is nothing to call
    /// (`LuaUnitScript.cpp:505-519`), which names no piece.
    #[test]
    fn a_missing_query_nano_piece_names_no_piece() {
        let timeline = sprayed("function script.Create() end", 3, 0, 2);

        assert_eq!(nano(&timeline), [(0, None), (1, None)]);
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w.contains("no QueryNanoPiece")));
    }
}

mod engine_factory {
    use super::*;
    use coilbox_unitpose::ScriptOutput;

    fn action(frame: u32, action: EngineAction) -> ScriptEvent {
        ScriptEvent {
            frame,
            callin: String::new(),
            args: Vec::new(),
            ambient: false,
            world: None,
            engine: Some(action),
        }
    }

    fn callin(frame: u32, name: &str) -> ScriptEvent {
        ScriptEvent {
            frame,
            callin: name.to_string(),
            args: Vec::new(),
            ambient: false,
            world: None,
            engine: None,
        }
    }

    fn build_start_frames(timeline: &Timeline) -> Vec<u32> {
        timeline
            .events
            .iter()
            .filter_map(|event| match event {
                ScriptOutput::BuildStart { frame } => Some(*frame),
                _ => None,
            })
            .collect()
    }

    fn nano_frames(timeline: &Timeline) -> Vec<u32> {
        timeline
            .events
            .iter()
            .filter_map(|event| match event {
                ScriptOutput::Nano { frame, .. } => Some(*frame),
                _ => None,
            })
            .collect()
    }

    fn sfx_frames(timeline: &Timeline, code: i32) -> Vec<u32> {
        timeline
            .events
            .iter()
            .filter_map(|event| match event {
                ScriptOutput::Sfx { frame, sfx, .. } if *sfx == code => Some(*frame),
                _ => None,
            })
            .collect()
    }

    const SCRIPT: &str = r#"
        local barrel = piece("barrel")
        function script.Activate()
            SetUnitValue(COB.INBUILDSTANCE, true)
        end
        function script.StartBuilding()
            EmitSfx(barrel, 42)
        end
    "#;

    const SLEEPY_SCRIPT: &str = r#"
        local barrel = piece("barrel")
        function script.Activate()
            Sleep(33)
            SetUnitValue(COB.INBUILDSTANCE, true)
        end
        function script.StartBuilding()
            EmitSfx(barrel, 42)
        end
    "#;

    /// `Factory.cpp:138-151`: a script that puts its unit in build stance the
    /// moment it is asked to starts building the same frame the engine asks.
    #[test]
    fn building_starts_on_the_frame_the_script_sets_build_stance() {
        let events = vec![callin(0, "Activate"), action(0, EngineAction::FactoryBuild)];
        let timeline = run(
            SCRIPT,
            "test.lua",
            &Unit::new(&pieces()),
            &events,
            4,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert_eq!(build_start_frames(&timeline), [0]);
        assert_eq!(sfx_frames(&timeline, 42), [0]);
        assert!(nano_frames(&timeline).contains(&0));
    }

    /// `Factory.cpp:138-151`: `Activate` and the stance check run in the same
    /// `Update`, whatever order the frame lists them in. A `factory-build`
    /// event queued before `Activate` must not push the build a frame late.
    #[test]
    fn building_starts_the_same_frame_even_when_factory_build_is_listed_first() {
        let events = vec![action(0, EngineAction::FactoryBuild), callin(0, "Activate")];
        let timeline = run(
            SCRIPT,
            "test.lua",
            &Unit::new(&pieces()),
            &events,
            4,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert_eq!(build_start_frames(&timeline), [0]);
        assert_eq!(sfx_frames(&timeline, 42), [0]);
        assert!(nano_frames(&timeline).contains(&0));
    }

    /// A script that sleeps first, standing in for an opening animation, only
    /// starts building once it actually sets the stance.
    #[test]
    fn building_waits_for_an_opening_animation_before_starting() {
        let events = vec![callin(0, "Activate"), action(0, EngineAction::FactoryBuild)];
        let timeline = run(
            SLEEPY_SCRIPT,
            "test.lua",
            &Unit::new(&pieces()),
            &events,
            4,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert_eq!(build_start_frames(&timeline), [2]);
        assert_eq!(sfx_frames(&timeline, 42), [2]);
        assert_eq!(nano_frames(&timeline), [2, 3]);
    }

    /// The script never sets INBUILDSTANCE, so the factory never builds, and
    /// `factory-finish` says so rather than firing `StopBuilding`.
    #[test]
    fn a_script_that_never_sets_build_stance_never_builds() {
        let events = vec![
            callin(0, "Activate"),
            action(0, EngineAction::FactoryBuild),
            action(3, EngineAction::FactoryFinish),
        ];
        let timeline = run(
            "function script.Activate() end",
            "test.lua",
            &Unit::new(&pieces()),
            &events,
            4,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert!(build_start_frames(&timeline).is_empty());
        assert!(nano_frames(&timeline).is_empty());
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w.contains("never set INBUILDSTANCE")));
    }

    /// Build stance seeded from the preview's Unit values panel counts too:
    /// building starts on the `factory-build` frame straight away.
    #[test]
    fn a_seeded_build_stance_starts_building_on_the_factory_build_frame() {
        let events = vec![action(2, EngineAction::FactoryBuild)];
        let values = HashMap::from([(unitvalue::INBUILDSTANCE, 1)]);
        let timeline = run(
            "function script.StartBuilding() end",
            "test.lua",
            &Unit::new(&pieces()),
            &events,
            4,
            &values,
        );

        assert_eq!(timeline.error, None);
        assert_eq!(build_start_frames(&timeline), [2]);
    }

    /// `factory-finish` stops the spraying and runs `StopBuilding`.
    #[test]
    fn factory_finish_stops_spraying_and_runs_stop_building() {
        let script = r#"
            local barrel = piece("barrel")
            function script.Activate()
                SetUnitValue(COB.INBUILDSTANCE, true)
            end
            function script.StartBuilding()
                EmitSfx(barrel, 42)
            end
            function script.StopBuilding()
                EmitSfx(barrel, 99)
            end
        "#;
        let events = vec![
            callin(0, "Activate"),
            action(0, EngineAction::FactoryBuild),
            action(3, EngineAction::FactoryFinish),
        ];
        let timeline = run(
            script,
            "test.lua",
            &Unit::new(&pieces()),
            &events,
            6,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert_eq!(nano_frames(&timeline), [0, 1, 2]);
        assert_eq!(sfx_frames(&timeline, 99), [3]);
    }

    fn scene(pos: Option<[f64; 3]>) -> coilbox_unitpose::World {
        coilbox_unitpose::World {
            stand_in: Some(coilbox_unitpose::StandIn {
                id: 2,
                pos,
                radius: 28.0,
                height: 30.8,
            }),
            own: coilbox_unitpose::Size {
                radius: 60.0,
                height: 40.0,
            },
        }
    }

    /// The world handed to `Run` before it starts already carries the stand-in
    /// on its build piece's rest position, because the preview cannot know the
    /// run's own `build-start` frame ahead of time. But the buildee itself does
    /// not exist until the script actually reaches build stance, so a question
    /// asked while awaiting build stance reads as though there were no
    /// stand-in at all, the same world data notwithstanding. Once building
    /// starts, the same question reads the real position.
    #[test]
    fn hides_the_stand_in_from_the_world_while_awaiting_build_stance() {
        let script = r#"
            local base = piece("base")
            local turret = piece("turret")
            function script.Activate()
                Sleep(33)
                SetUnitValue(COB.INBUILDSTANCE, true)
            end
            function script.ProbeBefore()
                Move(base, z_axis, GetUnitValue(COB.UNIT_Y, 2) / 65536)
            end
            function script.ProbeAfter()
                Move(turret, z_axis, GetUnitValue(COB.UNIT_Y, 2) / 65536)
            end
        "#;
        let world = Some(scene(Some([0.0, 3.0, 84.0])));
        let events = vec![
            callin(0, "Activate"),
            action(0, EngineAction::FactoryBuild),
            ScriptEvent {
                frame: 1,
                callin: "ProbeBefore".to_string(),
                args: Vec::new(),
                ambient: false,
                world: world.clone(),
                engine: None,
            },
            ScriptEvent {
                frame: 4,
                callin: "ProbeAfter".to_string(),
                args: Vec::new(),
                ambient: false,
                world,
                engine: None,
            },
        ];
        let timeline = run(
            script,
            "test.lua",
            &Unit::new(&pieces()),
            &events,
            6,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        // Confirms the probes land either side of build-start.
        assert_eq!(build_start_frames(&timeline), [2]);
        assert_close(pose(&timeline, 1, "base")[2], 0.0);
        assert_close(pose(&timeline, 4, "turret")[2], 3.0);
    }

    /// The same hiding as above, through the `Spring.*` calls a Lua transport
    /// uses instead of `GetUnitValue`: `GetUnitPosition`, `GetUnitHeight` and
    /// `GetUnitRadius` answer as for a unit that is not there while a factory
    /// awaits build stance, and for real once building has started.
    #[test]
    fn hides_the_stand_in_from_spring_calls_while_awaiting_build_stance() {
        let script = r#"
            local base = piece("base")
            function script.Activate()
                Sleep(33)
                SetUnitValue(COB.INBUILDSTANCE, true)
            end
            function script.ProbeBefore()
                if Spring.GetUnitPosition(2) ~= nil then error("found a position") end
                if Spring.GetUnitHeight(2) ~= nil then error("found a height") end
                if Spring.GetUnitRadius(2) ~= nil then error("found a radius") end
            end
            function script.ProbeAfter()
                local _, _, z = Spring.GetUnitPosition(2)
                Move(base, z_axis, z)
            end
        "#;
        let world = Some(scene(Some([0.0, 3.0, 84.0])));
        let events = vec![
            callin(0, "Activate"),
            action(0, EngineAction::FactoryBuild),
            ScriptEvent {
                frame: 1,
                callin: "ProbeBefore".to_string(),
                args: Vec::new(),
                ambient: false,
                world: world.clone(),
                engine: None,
            },
            ScriptEvent {
                frame: 4,
                callin: "ProbeAfter".to_string(),
                args: Vec::new(),
                ambient: false,
                world,
                engine: None,
            },
        ];
        let timeline = run(
            script,
            "test.lua",
            &Unit::new(&pieces()),
            &events,
            6,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert_eq!(build_start_frames(&timeline), [2]);
        // A thread that errors takes only itself down, so a wrongly answered
        // position shows up as a note rather than `timeline.error`.
        assert!(
            !timeline.warnings.iter().any(|w| w.contains("found a")),
            "{:?}",
            timeline.warnings
        );
        assert_close(pose(&timeline, 4, "base")[2], 84.0);
    }
}

mod engine_fire {
    use super::*;
    use coilbox_unitpose::ScriptOutput;

    fn fire(frame: u32, weapon: f64) -> ScriptEvent {
        ScriptEvent {
            frame,
            callin: String::new(),
            args: vec![weapon],
            ambient: false,
            world: None,
            engine: Some(EngineAction::Fire),
        }
    }

    fn fired(script: &str, events: &[ScriptEvent], frames: u32) -> Timeline {
        let mut all = vec![ScriptEvent {
            frame: 0,
            callin: "Create".into(),
            args: Vec::new(),
            ambient: false,
            world: None,
            engine: None,
        }];
        all.extend_from_slice(events);
        run(
            script,
            "test.lua",
            &Unit::new(&pieces()),
            &all,
            frames,
            &HashMap::new(),
        )
    }

    #[test]
    fn show_flare_records_a_flare_and_leaves_the_piece_hidden() {
        let timeline = fired(
            r#"
            local turret, barrel = piece("turret", "barrel")
            function script.Create() Hide(barrel) end
            function script.QueryWeapon1() return barrel end
            function script.FireWeapon1() Spring.UnitScript.ShowFlare(barrel) end
            "#,
            &[fire(5, 1.0)],
            8,
        );

        assert_eq!(timeline.error, None);
        assert!(timeline.events.contains(&ScriptOutput::Flare {
            frame: 5,
            piece: "barrel".into()
        }));
        let index = timeline.pieces.iter().position(|p| p == "barrel").unwrap();
        assert!(timeline.hidden[7][index]);
    }

    #[test]
    fn fire_calls_fire_then_shot_then_query_weapon_on_its_frame() {
        let timeline = fired(
            r#"
            local base, turret, barrel = piece("base", "turret", "barrel")
            local muzzle = turret
            function script.FireWeapon1() muzzle = base end
            function script.Shot1() muzzle = barrel end
            function script.QueryWeapon1() return muzzle end
            "#,
            &[fire(5, 1.0)],
            8,
        );

        assert!(timeline.events.contains(&ScriptOutput::Shot {
            frame: 5,
            weapon: 1,
            piece: Some("barrel".into())
        }));
    }

    /// `RunQueryCallIn` answers -1 for a missing `QueryWeapon`, so the engine
    /// falls back to the `AimFromWeapon` piece (`Weapon.cpp:235-260`).
    #[test]
    fn a_missing_query_weapon_falls_back_to_aim_from_weapon() {
        let timeline = fired(
            r#"
            local turret = piece("turret")
            function script.AimFromWeapon1() return turret end
            "#,
            &[fire(5, 1.0)],
            8,
        );

        assert!(timeline.events.contains(&ScriptOutput::Shot {
            frame: 5,
            weapon: 1,
            piece: Some("turret".into())
        }));
    }

    #[test]
    fn no_weapon_piece_at_all_records_a_shot_from_no_piece_and_says_so() {
        let timeline = fired("function script.Create() end", &[fire(5, 1.0)], 8);

        assert!(timeline.events.contains(&ScriptOutput::Shot {
            frame: 5,
            weapon: 1,
            piece: None
        }));
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w == "The script named no weapon piece."));
    }

    #[test]
    fn show_flare_is_on_the_unit_script_table_too() {
        let timeline = fired(
            r#"
            local barrel = piece("barrel")
            function script.FireWeapon1() UnitScript.ShowFlare(barrel) ShowFlare(barrel) end
            "#,
            &[fire(5, 1.0)],
            8,
        );

        assert_eq!(timeline.error, None);
        assert_eq!(
            timeline
                .events
                .iter()
                .filter(|e| matches!(e, ScriptOutput::Flare { .. }))
                .count(),
            2
        );
    }
}
