//! What the compiled-script runtime has to get right.
//!
//! The programs here are assembled by hand, one opcode at a time, because that
//! is the only way to test an opcode in isolation: a `.bos` compiled through
//! the compiler would test the compiler too, and a failure would not say which
//! of the two was wrong.
//!
//! The fixed-point conversions get the most attention. COB counts angles in
//! 65536ths of a circle and distances in 65536ths of an elmo, and the engine
//! negates three of them on the way in. Getting any of that wrong animates a
//! unit that looks almost right, which is the worst kind of wrong.

use std::collections::HashMap;

use super::*;
use crate::opcodes;

const PIECES: &[&str] = &["base", "turret", "barrel"];

/// A quarter circle in COB's angular units, where 65536 is a full turn.
const QUARTER: u32 = 16384;

/// One elmo, in the 65536ths COB measures distance in.
const ELMO: u32 = 65536;

fn model_pieces() -> Vec<String> {
    PIECES.iter().map(|name| (*name).to_string()).collect()
}

fn op(name: &str) -> u32 {
    opcodes::opcode(name).expect("mnemonic is in the opcode table")
}

/// Assemble a COB from scripts of raw instruction words.
fn build(scripts: &[(&str, Vec<u32>)], pieces: &[&str], statics: usize) -> Vec<u8> {
    let names: Vec<String> = scripts.iter().map(|(n, _)| (*n).to_string()).collect();
    let code: HashMap<String, Vec<u8>> = scripts
        .iter()
        .map(|(name, words)| {
            (
                (*name).to_string(),
                words.iter().flat_map(|w| w.to_le_bytes()).collect(),
            )
        })
        .collect();
    let pieces: Vec<String> = pieces.iter().map(|p| (*p).to_string()).collect();
    let statics: Vec<String> = (0..statics).map(|i| format!("var{i}")).collect();
    cob::encode(&names, &code, &pieces, &statics, 4)
}

/// A COB whose only script is `Create`, over the standard three pieces.
fn create_only(words: Vec<u32>) -> Vec<u8> {
    build(&[("Create", words)], PIECES, 0)
}

fn created() -> Vec<ScriptEvent> {
    vec![ScriptEvent {
        frame: 0,
        callin: "Create".to_string(),
        args: Vec::new(),
        ambient: false,
        world: None,
        engine: None,
    }]
}

fn play(bytes: &[u8], frames: u32) -> Timeline {
    run(
        bytes,
        &model_pieces(),
        &created(),
        frames,
        &[],
        &HashMap::new(),
    )
}

/// One piece's numbers on one frame: x, y, z offset then x, y, z rotation.
fn pose(timeline: &Timeline, frame: usize, piece: &str) -> [f64; 6] {
    let index = timeline
        .pieces
        .iter()
        .position(|name| name == piece)
        .expect("piece is in the timeline");
    let mut out = [0.0; 6];
    out.copy_from_slice(&timeline.frames[frame][index * 6..index * 6 + 6]);
    out
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-6
}

/// `push value` then whatever follows it.
fn push(value: u32) -> Vec<u32> {
    vec![op("PUSH_CONSTANT"), value]
}

mod motion {
    use super::*;

    #[test]
    fn moves_a_piece_where_the_script_says() {
        // move base to z-axis [1] now
        let mut code = push(ELMO);
        code.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let timeline = play(&create_only(code), 2);

        assert!(close(pose(&timeline, 0, "base")[2], 1.0));
    }

    /// COB counts distance in 65536ths of an elmo. A runtime that took the
    /// number at face value would move a piece 65536 times too far.
    #[test]
    fn reads_a_distance_as_65536ths_of_an_elmo() {
        let mut code = push(ELMO / 2);
        code.extend([op("MOVE_NOW"), 1, 1, op("RETURN")]);

        let timeline = play(&create_only(code), 2);

        assert!(close(pose(&timeline, 0, "turret")[1], 0.5));
    }

    /// One of the engine's three sign flips, the ones `CobInstance.h` labels
    /// COBWTF. Without it every unit that slides a piece sideways slides it the
    /// wrong way.
    #[test]
    fn flips_the_sign_of_a_move_along_x() {
        let mut code = push(ELMO);
        code.extend([op("MOVE_NOW"), 0, 0, op("RETURN")]);

        let timeline = play(&create_only(code), 2);

        assert!(close(pose(&timeline, 0, "base")[0], -1.0));
    }

    #[test]
    fn turns_a_piece_where_the_script_says() {
        let mut code = push(QUARTER);
        code.extend([op("TURN_NOW"), 1, 1, op("RETURN")]);

        let timeline = play(&create_only(code), 2);

        assert!(close(
            pose(&timeline, 0, "turret")[4],
            std::f64::consts::FRAC_PI_2
        ));
    }

    /// The second sign flip. A turn about z is negated, which is why the BOS to
    /// Lua converter negates it too.
    #[test]
    fn flips_the_sign_of_a_turn_about_z() {
        let mut code = push(QUARTER);
        code.extend([op("TURN_NOW"), 1, 2, op("RETURN")]);

        let timeline = play(&create_only(code), 2);

        // Rotations are kept in [0, TAU), so a quarter turn the other way reads
        // as three quarters of a turn forwards.
        assert!(close(
            pose(&timeline, 0, "turret")[5],
            std::f64::consts::TAU - std::f64::consts::FRAC_PI_2
        ));
    }

    /// A turn with a speed takes time, at the rate the script asked for.
    #[test]
    fn turns_at_the_speed_the_script_asked_for() {
        // turn turret to y-axis [quarter] speed [quarter per second]
        let mut code = push(QUARTER); // speed, pushed first
        code.extend(push(QUARTER)); // destination, on top
        code.extend([op("TURN"), 1, 1, op("RETURN")]);

        let timeline = play(&create_only(code), 33);

        // A quarter circle at a quarter circle per second is one second away.
        // The turn starts after frame zero has already ticked, so it is a
        // fraction of the way there on frame one and arrives on frame thirty.
        let early = pose(&timeline, 1, "turret")[4];
        assert!(early > 0.0 && early < std::f64::consts::FRAC_PI_2);
        assert!(close(
            pose(&timeline, 30, "turret")[4],
            std::f64::consts::FRAC_PI_2
        ));
    }

    #[test]
    fn spins_a_piece_continuously() {
        let mut code = push(0); // accel, pushed first
        code.extend(push(QUARTER)); // speed, on top
        code.extend([op("SPIN"), 1, 1, op("RETURN")]);

        let timeline = play(&create_only(code), 20);

        let first = pose(&timeline, 0, "turret")[4];
        let later = pose(&timeline, 10, "turret")[4];
        assert!(later > first, "a spin keeps turning: {first} then {later}");
    }

    /// The third sign flip: a spin about z, unlike a turn, negates the speed.
    #[test]
    fn flips_the_sign_of_a_spin_about_z() {
        let mut code = push(0);
        code.extend(push(QUARTER));
        code.extend([op("SPIN"), 1, 2, op("RETURN")]);

        let timeline = play(&create_only(code), 10);

        // Turning backwards from zero wraps round the top of the range.
        assert!(pose(&timeline, 5, "turret")[5] > std::f64::consts::PI);
    }

    #[test]
    fn hides_and_shows_a_piece() {
        let code = vec![op("HIDE"), 2, op("RETURN")];

        let timeline = play(&create_only(code), 2);

        let index = timeline
            .pieces
            .iter()
            .position(|name| name == "barrel")
            .unwrap();
        assert!(timeline.hidden[0][index]);
    }
}

mod stack_and_arithmetic {
    use super::*;

    /// Every arithmetic opcode drives the same check: compute a number, move a
    /// piece by it, and read the piece.
    fn computed(words: Vec<u32>) -> f64 {
        let mut code = words;
        code.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);
        pose(&play(&create_only(code), 2), 0, "base")[2]
    }

    #[test]
    fn adds() {
        let mut code = push(ELMO);
        code.extend(push(ELMO));
        code.push(op("ADD"));
        assert!(close(computed(code), 2.0));
    }

    /// Subtraction and division care which operand is which, so both are
    /// checked with operands that would pass either way round if they did not.
    #[test]
    fn subtracts_the_top_of_the_stack_from_the_one_below() {
        let mut code = push(ELMO * 3);
        code.extend(push(ELMO));
        code.push(op("SUB"));
        assert!(close(computed(code), 2.0));
    }

    #[test]
    fn divides_the_one_below_by_the_top() {
        let mut code = push(ELMO * 6);
        code.extend(push(3));
        code.push(op("DIV"));
        assert!(close(computed(code), 2.0));
    }

    /// The engine answers a thousand rather than failing, so a script that
    /// divides by zero keeps animating.
    #[test]
    fn answers_a_division_by_zero_rather_than_stopping() {
        let mut code = push(ELMO);
        code.extend(push(0));
        code.push(op("DIV"));
        let mut program = code;
        program.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let timeline = play(&create_only(program), 2);

        assert!(timeline.error.is_none());
        assert!(timeline
            .warnings
            .iter()
            .any(|note| note.contains("divides by zero")));
    }

    #[test]
    fn compares() {
        let mut code = push(2);
        code.extend(push(1));
        code.push(op("SET_GREATER"));
        code.extend(push(ELMO));
        code.push(op("MUL"));
        assert!(close(computed(code), 1.0));
    }

    #[test]
    fn keeps_a_value_in_a_static_var_between_scripts() {
        let mut create = push(ELMO * 2);
        create.extend([op("POP_STATIC"), 0, op("RETURN")]);
        let mut moving = vec![op("PUSH_STATIC"), 0];
        moving.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("Create", create), ("StartMoving", moving)], PIECES, 1);
        let events = vec![
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
                callin: "StartMoving".to_string(),
                args: Vec::new(),
                ambient: false,
                world: None,
                engine: None,
            },
        ];

        let timeline = run(&bytes, &model_pieces(), &events, 3, &[], &HashMap::new());

        assert!(close(pose(&timeline, 1, "base")[2], 2.0));
    }
}

mod control_flow {
    use super::*;

    /// A jump lands at an offset into the whole code stream, not into the
    /// script it is inside. Getting that wrong is invisible on a one-script
    /// file and breaks everything after the first script on a real one.
    #[test]
    fn jumps_over_the_instructions_it_skips() {
        // Create is the second script, so its code does not start at zero.
        let first = vec![op("RETURN")];
        // The first script is one word, and the seven the jump skips follow it.
        let jump_to = 1 + 7;
        let mut create = vec![op("JUMP"), jump_to as u32];
        create.extend(push(ELMO)); // skipped
        create.extend([op("MOVE_NOW"), 0, 2]); // skipped
        create.extend(push(ELMO * 3));
        create.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("Killed", first), ("Create", create)], PIECES, 0);
        let timeline = play(&bytes, 2);

        assert!(close(pose(&timeline, 0, "base")[2], 3.0));
    }

    #[test]
    fn takes_a_branch_only_when_the_test_fails() {
        let mut code = push(0); // false, so the jump is taken
        code.extend([op("JUMP_NOT_EQUAL"), 9]);
        code.extend(push(ELMO)); // skipped
        code.extend([op("MOVE_NOW"), 0, 2]);
        code.extend(push(ELMO * 5));
        code.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let timeline = play(&create_only(code), 2);

        assert!(close(pose(&timeline, 0, "base")[2], 5.0));
    }

    #[test]
    fn calls_another_script_and_comes_back() {
        let mut helper = push(ELMO * 4);
        helper.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);
        let create = vec![op("CALL_SCRIPT"), 1, 0, op("RETURN")];

        let bytes = build(&[("Create", create), ("helper", helper)], PIECES, 0);
        let timeline = play(&bytes, 2);

        assert!(close(pose(&timeline, 0, "base")[2], 4.0));
    }

    /// Returning drops what the called script put on the stack and nothing
    /// else. Dropping one word too many takes the caller's own local with it,
    /// which is invisible until a unit whose walk loop calls out to `stand`
    /// stands there doing nothing.
    #[test]
    fn a_call_leaves_the_callers_locals_where_they_were() {
        // The helper makes a local of its own, so it has something to drop.
        let mut helper = vec![op("CREATE_LOCAL_VAR")];
        helper.extend(push(7));
        helper.extend([op("POP_LOCAL_VAR"), 0]);
        helper.extend(push(0));
        helper.push(op("RETURN"));

        // Create holds a distance in a local across the call and moves by it.
        let mut create = vec![op("CREATE_LOCAL_VAR")];
        create.extend(push(ELMO * 2));
        create.extend([op("POP_LOCAL_VAR"), 0]);
        create.extend([op("CALL_SCRIPT"), 1, 0]);
        create.extend([op("PUSH_LOCAL_VAR"), 0]);
        create.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("Create", create), ("helper", helper)], PIECES, 0);
        let timeline = play(&bytes, 2);

        assert!(close(pose(&timeline, 0, "base")[2], 2.0));
    }

    /// A started script runs on its own thread, so the caller carries on
    /// without waiting for it and both are visible.
    #[test]
    fn starts_a_script_on_its_own_thread() {
        let mut spun = push(0);
        spun.extend(push(QUARTER));
        spun.extend([op("SPIN"), 1, 1, op("RETURN")]);
        let mut create = vec![op("START_SCRIPT"), 1, 0];
        create.extend(push(ELMO));
        create.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("Create", create), ("spinner", spun)], PIECES, 0);
        let timeline = play(&bytes, 10);

        assert!(close(pose(&timeline, 0, "base")[2], 1.0));
        assert!(pose(&timeline, 5, "turret")[4] > 0.0);
    }

    #[test]
    fn sleeps_before_carrying_on() {
        let mut code = push(500); // half a second
        code.push(op("SLEEP"));
        code.extend(push(ELMO));
        code.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let timeline = play(&create_only(code), 30);

        assert!(close(pose(&timeline, 5, "base")[2], 0.0));
        assert!(close(pose(&timeline, 20, "base")[2], 1.0));
    }

    /// How a BOS script stops the last copy of itself. A started thread takes
    /// on the mask its parent had, so a signal reaches it.
    #[test]
    fn a_signal_kills_a_thread_carrying_its_mask() {
        // Waits, then moves. Killed first, it never moves.
        let mut waiter = push(300);
        waiter.push(op("SLEEP"));
        waiter.extend(push(ELMO * 5));
        waiter.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);
        // Takes a mask, starts the waiter under it, then raises that signal.
        let mut create = push(2);
        create.push(op("SET_SIGNAL_MASK"));
        create.extend([op("START_SCRIPT"), 1, 0]);
        create.extend(push(100));
        create.push(op("SLEEP"));
        create.extend(push(2));
        create.push(op("SIGNAL"));
        create.push(op("RETURN"));

        let bytes = build(&[("Create", create), ("waiter", waiter)], PIECES, 0);
        let timeline = play(&bytes, 30);

        assert!(close(pose(&timeline, 29, "base")[2], 0.0));
    }

    #[test]
    fn waits_for_a_turn_to_finish_before_the_next_line() {
        let mut code = push(QUARTER); // speed
        code.extend(push(QUARTER)); // destination
        code.extend([op("TURN"), 1, 1]);
        code.extend([op("WAIT_FOR_TURN"), 1, 1]);
        code.extend(push(ELMO));
        code.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let timeline = play(&create_only(code), 40);

        // The turn takes a second, so the move after the wait has not happened
        // half way through and has by the end.
        assert!(close(pose(&timeline, 10, "base")[2], 0.0));
        assert!(close(pose(&timeline, 35, "base")[2], 1.0));
    }
}

mod what_it_says_about_itself {
    use super::*;

    #[test]
    fn reports_a_file_that_is_not_a_cob() {
        let timeline = run(
            b"not a cob",
            &model_pieces(),
            &created(),
            5,
            &[],
            &HashMap::new(),
        );

        assert!(timeline.error.is_some());
        assert!(timeline.frames.is_empty());
    }

    /// The preview tells a unit things it cannot work out for itself, such as
    /// what it is standing on. Almost no unit defines those call-ins, so
    /// reporting a missing one would report it about nearly every unit.
    #[test]
    fn stays_quiet_about_a_call_in_it_only_fired_to_describe_the_world() {
        let timeline = run(
            &create_only(vec![op("RETURN")]),
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "setSFXoccupy".to_string(),
                args: vec![4.0],
                ambient: true,
                world: None,
                engine: None,
            }],
            3,
            &[],
            &HashMap::new(),
        );

        assert_eq!(timeline.warnings, Vec::<String>::new());
    }

    #[test]
    fn says_when_the_script_has_no_such_call_in() {
        let timeline = run(
            &create_only(vec![op("RETURN")]),
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "StartMoving".to_string(),
                args: Vec::new(),
                ambient: false,
                world: None,
                engine: None,
            }],
            3,
            &[],
            &HashMap::new(),
        );

        assert!(timeline
            .warnings
            .iter()
            .any(|note| note.contains("StartMoving")));
    }

    /// An old `.cob` calls its first weapon Primary, and the scenarios the
    /// builder offers are written in the names Recoil uses now.
    #[test]
    fn finds_a_weapon_call_in_under_its_older_name() {
        let mut aim = push(ELMO);
        aim.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("AimPrimary", aim)], PIECES, 0);
        let timeline = run(
            &bytes,
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "AimWeapon1".to_string(),
                args: Vec::new(),
                ambient: false,
                world: None,
                engine: None,
            }],
            3,
            &[],
            &HashMap::new(),
        );

        assert!(close(pose(&timeline, 0, "base")[2], 1.0));
    }

    /// A scenario says "aim a bit to the left" in radians, because that is what
    /// the Lua unit script framework takes. A `.cob` counts angles in 65536ths
    /// of a circle, so the same instruction has to arrive as a different
    /// number or every compiled turret aims at nothing.
    #[test]
    fn hands_an_aiming_angle_over_in_the_units_a_cob_counts_in() {
        // AimPrimary takes a heading and a pitch, and moves by the heading.
        let mut aim = vec![op("CREATE_LOCAL_VAR"), op("CREATE_LOCAL_VAR")];
        aim.extend([op("PUSH_LOCAL_VAR"), 0]);
        aim.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("AimPrimary", aim)], PIECES, 0);
        let timeline = run(
            &bytes,
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "AimWeapon1".to_string(),
                args: vec![0.8, 0.15],
                ambient: false,
                world: None,
                engine: None,
            }],
            3,
            &[],
            &HashMap::new(),
        );

        // Radians into COB units and back out through the distance scale is the
        // angle as a fraction of a full circle.
        let expected = 0.8 / std::f64::consts::TAU;
        assert!((pose(&timeline, 0, "base")[2] - expected).abs() < 1e-4);
    }

    /// COB identifies a passenger by its model height in 65536ths, not by a
    /// unit id: `CCobInstance::BeginTransport` at
    /// `rts/Sim/Units/Scripts/CobInstance.cpp:355-360`. The scenario is written
    /// in the Lua form, so the runtime converts, exactly as it does for radians.
    #[test]
    fn hands_begin_transport_a_height_rather_than_a_unit_id() {
        // BeginTransport takes one argument and moves the base by it.
        let mut begin = vec![op("CREATE_LOCAL_VAR")];
        begin.extend([op("PUSH_LOCAL_VAR"), 0]);
        begin.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("BeginTransport", begin)], PIECES, 0);
        let timeline = run(
            &bytes,
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "BeginTransport".to_string(),
                // The stand-in's height in elmos, which is what the scenario's
                // single argument means once the runtime has it.
                args: vec![12.0],
                ambient: false,
                world: None,
                engine: None,
            }],
            3,
            &[],
            &HashMap::new(),
        );

        // 12 elmos as 65536ths, read back out through the distance scale.
        assert!(close(pose(&timeline, 0, "base")[2], 12.0));
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

    /// `get UNIT_Y(unitid)` then move the base by it, from a call-in handed
    /// the stand-in's id, as `TransportPickup` is.
    fn reads_y_of_the_passenger() -> Vec<u8> {
        let mut pickup = vec![op("CREATE_LOCAL_VAR")];
        pickup.extend(push(10));
        pickup.extend([op("PUSH_LOCAL_VAR"), 0]);
        pickup.extend(push(0));
        pickup.extend(push(0));
        pickup.extend(push(0));
        pickup.push(op("GET"));
        pickup.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);
        build(&[("TransportPickup", pickup)], PIECES, 0)
    }

    #[test]
    fn tells_a_transport_where_its_passenger_is() {
        let timeline = run(
            &reads_y_of_the_passenger(),
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "TransportPickup".to_string(),
                args: vec![2.0],
                ambient: false,
                world: Some(scene(Some([0.0, 3.0, 84.0]))),
                engine: None,
            }],
            2,
            &[],
            &HashMap::new(),
        );

        assert!(close(pose(&timeline, 0, "base")[2], 3.0));
        assert!(
            !timeline
                .warnings
                .iter()
                .any(|note| note.contains("the world")),
            "{:?}",
            timeline.warnings
        );
    }

    /// A running thread reads whatever scene the timeline is on when it wakes,
    /// even on a frame whose own event fires a call-in the script has no
    /// handler for. A snapshot only the running script's frame carries would
    /// leave the read stuck on stale data whenever a scenario steps the world
    /// through a call-in the script does not define.
    #[test]
    fn a_snapshot_applies_even_without_a_call_in() {
        // Claims the passenger's id, sleeps past frame 2, then reads its Y
        // and moves the base by it.
        let mut pickup = vec![op("CREATE_LOCAL_VAR")];
        pickup.extend(push(200)); // 200ms, 6 frames at 30fps
        pickup.push(op("SLEEP"));
        pickup.extend(push(10)); // UNIT_Y
        pickup.extend([op("PUSH_LOCAL_VAR"), 0]);
        pickup.extend(push(0));
        pickup.extend(push(0));
        pickup.extend(push(0));
        pickup.push(op("GET"));
        pickup.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);
        let bytes = build(&[("TransportPickup", pickup)], PIECES, 0);

        let first = ScriptEvent {
            frame: 0,
            callin: "TransportPickup".to_string(),
            args: vec![2.0],
            ambient: false,
            world: Some(scene(Some([0.0, 1.0, 0.0]))),
            engine: None,
        };
        // No call-in the script defines, so this event only carries the world
        // forward to the frame the sleeping thread wakes into.
        let second = ScriptEvent {
            frame: 2,
            callin: "Activate".to_string(),
            args: Vec::new(),
            ambient: false,
            world: Some(scene(Some([0.0, 5.0, 0.0]))),
            engine: None,
        };
        let timeline = run(
            &bytes,
            &model_pieces(),
            &[first, second],
            12,
            &[],
            &HashMap::new(),
        );

        assert!(close(pose(&timeline, 11, "base")[2], 5.0));
    }

    /// COB's `BeginTransport` takes the passenger's model height, not its id
    /// (`CobInstance.cpp:355-360`).
    #[test]
    fn hands_begin_transport_the_stand_ins_height_when_there_is_one() {
        let mut begin = vec![op("CREATE_LOCAL_VAR")];
        begin.extend([op("PUSH_LOCAL_VAR"), 0]);
        begin.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);
        let bytes = build(&[("BeginTransport", begin)], PIECES, 0);

        let timeline = run(
            &bytes,
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "BeginTransport".to_string(),
                args: vec![2.0],
                ambient: false,
                world: Some(scene(Some([0.0, 0.0, 0.0]))),
                engine: None,
            }],
            2,
            &[],
            &HashMap::new(),
        );

        assert!((pose(&timeline, 0, "base")[2] - 30.8).abs() < 1e-4);
    }

    /// `CCobInstance::TransportDrop` packs x and z into one word and drops y
    /// entirely (`CobInstance.cpp:385-395`, `CobInstance.h:10`), where Lua
    /// takes four separate numbers.
    #[test]
    fn packs_a_transport_drop_position_the_way_a_cob_reads_it() {
        // TransportDrop takes two arguments in COB. Move by the second, along
        // z rather than x, because a move along x is one of the engine's three
        // sign flips and this is about the packing rather than the axes.
        let mut drop = vec![op("CREATE_LOCAL_VAR"), op("CREATE_LOCAL_VAR")];
        drop.extend([op("PUSH_LOCAL_VAR"), 1]);
        drop.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("TransportDrop", drop)], PIECES, 0);
        let timeline = run(
            &bytes,
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "TransportDrop".to_string(),
                // Lua's (unitID, x, y, z).
                args: vec![1.0, 3.0, 9.0, 5.0],
                ambient: false,
                world: None,
                engine: None,
            }],
            3,
            &[],
            &HashMap::new(),
        );

        // PACKXZ(3, 5) is (3 << 16) + 5, which the distance scale reads back as
        // three and a very small fraction. The y of 9 is nowhere in it.
        let packed = f64::from((3i32 << 16) + 5) / 65536.0;
        assert!((pose(&timeline, 0, "base")[2] - packed).abs() < 1e-4);
    }

    /// A call-in that takes plain numbers is still handed them unchanged, so
    /// the conversions above cannot leak into everything else.
    #[test]
    fn leaves_an_ordinary_callins_arguments_alone() {
        let mut hit = vec![op("CREATE_LOCAL_VAR")];
        hit.extend([op("PUSH_LOCAL_VAR"), 0]);
        hit.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("HitByWeapon", hit)], PIECES, 0);
        let timeline = run(
            &bytes,
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "HitByWeapon".to_string(),
                args: vec![7.0],
                ambient: false,
                world: None,
                engine: None,
            }],
            3,
            &[],
            &HashMap::new(),
        );

        // Seven straight through, read back out through the distance scale.
        assert!(close(pose(&timeline, 0, "base")[2], 7.0 / 65536.0));
    }

    /// The script names its pieces and so does the model, and only the names
    /// tie them together: a `.cob` numbers its pieces its own way.
    #[test]
    fn matches_the_scripts_pieces_to_the_models_by_name() {
        let mut code = push(ELMO);
        // Piece 0 of this file is the model's third piece.
        code.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("Create", code)], &["barrel", "base"], 0);
        let timeline = play(&bytes, 2);

        assert!(close(pose(&timeline, 0, "barrel")[2], 1.0));
        assert!(close(pose(&timeline, 0, "base")[2], 0.0));
    }

    /// A script written against a model this one is not. Worth saying and not
    /// worth stopping for: the rest of the unit still animates.
    #[test]
    fn says_when_the_model_has_no_piece_the_script_names() {
        let mut code = push(ELMO);
        code.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("Create", code)], &["nosuchpiece"], 0);
        let timeline = play(&bytes, 2);

        assert!(timeline.error.is_none());
        assert!(timeline
            .warnings
            .iter()
            .any(|note| note.contains("nosuchpiece")));
    }

    #[test]
    fn stops_a_thread_that_loops_without_sleeping() {
        let code = vec![op("JUMP"), 0];

        let timeline = play(&create_only(code), 5);

        assert!(timeline.error.is_some());
    }

    /// A word that is not an opcode means this thread has walked into data, so
    /// the thread stops. The rest of the unit is unaffected and carries on, the
    /// way the Lua runtime treats a thread that throws.
    #[test]
    fn stops_the_thread_that_meets_a_word_that_is_not_an_opcode() {
        let code = vec![0xDEAD_BEEF, op("RETURN")];

        let timeline = play(&create_only(code), 3);

        assert_eq!(timeline.error, None);
        assert_eq!(timeline.frames.len(), 3);
        assert!(
            timeline
                .warnings
                .iter()
                .any(|note| note.contains("deadbeef")),
            "{:?}",
            timeline.warnings
        );
    }

    /// The preview has no world, so a script asking it about one is told that
    /// rather than being handed a number that looks like an answer.
    #[test]
    fn says_when_a_script_asks_about_the_world() {
        let mut code = push(1); // ACTIVATION
        code.push(op("GET_UNIT_VALUE"));
        code.push(op("POP_STACK"));
        code.push(op("RETURN"));

        let timeline = play(&create_only(code), 2);

        assert!(timeline
            .warnings
            .iter()
            .any(|note| note.contains("the world")));
    }

    /// `get PIECE_Y(turret)` pushes the turret's script piece number, counted
    /// from 0, and the engine reads exactly that piece (`SafeGetPiece(p1)` at
    /// `rts/Sim/Units/Scripts/UnitScript.h:80-85`).
    #[test]
    fn asks_about_the_piece_it_names_rather_than_the_one_before() {
        // get PIECE_Y(1, 0, 0, 0), then move the barrel along z by it.
        let mut code = push(8);
        code.extend(push(1));
        code.extend(push(0));
        code.extend(push(0));
        code.extend(push(0));
        code.push(op("GET"));
        code.extend([op("MOVE_NOW"), 2, 2, op("RETURN")]);
        // The turret seven above the base, the barrel one above that.
        let rest = [
            Rest {
                parent: None,
                position: [0.0, 0.0, 0.0],
            },
            Rest {
                parent: Some(0),
                position: [0.0, 7.0, 0.0],
            },
            Rest {
                parent: Some(1),
                position: [0.0, 1.0, 0.0],
            },
        ];

        let timeline = run(
            &create_only(code),
            &model_pieces(),
            &created(),
            2,
            &rest,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert!(close(pose(&timeline, 0, "barrel")[2], 7.0));
    }

    /// The engine stopped keeping shared values in Spring 102.0. The preview
    /// still keeps what a script stores, so a `.cob` and its converted Lua play
    /// the same, but says the game will not, rather than calling a shared value
    /// a question about the world.
    #[test]
    fn says_the_engine_no_longer_keeps_shared_values() {
        let mut code = push(2049);
        code.extend(push(1));
        code.push(op("SET"));
        code.extend(push(2050));
        code.push(op("GET_UNIT_VALUE"));
        code.push(op("POP_STACK"));
        code.push(op("RETURN"));

        let timeline = play(&create_only(code), 2);

        let shared: Vec<_> = timeline
            .warnings
            .iter()
            .filter(|note| note.contains("no longer keeps shared values"))
            .collect();
        assert_eq!(shared.len(), 2, "{:?}", timeline.warnings);
        assert!(
            !timeline
                .warnings
                .iter()
                .any(|note| note.contains("the world")),
            "{:?}",
            timeline.warnings
        );
    }
}

mod coverage {
    use super::*;

    /// A branch not taken never lights up: the disassembly's dimming has to be
    /// against instructions actually executed, not every one the bytes hold.
    #[test]
    fn a_branch_not_taken_is_not_among_the_offsets_run() {
        let mut code = push(0); // false, so the jump is taken
        code.extend([op("JUMP_NOT_EQUAL"), 9]);
        code.extend(push(ELMO)); // skipped: PUSH_CONSTANT at offset 4
        code.extend([op("MOVE_NOW"), 0, 2]); // skipped
        code.extend(push(ELMO * 5)); // taken: PUSH_CONSTANT at offset 9
        code.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let timeline = play(&create_only(code), 2);

        assert!(close(pose(&timeline, 0, "base")[2], 5.0));
        assert!(
            !timeline.offsets_run.contains(&4),
            "{:?}",
            timeline.offsets_run
        );
        assert!(
            timeline.offsets_run.contains(&9),
            "{:?}",
            timeline.offsets_run
        );
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

    fn pickup(bytes: &[u8]) -> Timeline {
        run(
            bytes,
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "TransportPickup".to_string(),
                args: vec![2.0],
                ambient: false,
                world: Some(scene()),
                engine: None,
            }],
            2,
            &[],
            &HashMap::new(),
        )
    }

    #[test]
    fn records_an_effect_on_its_piece_and_frame() {
        let mut create = push(1025);
        create.extend([op("EMIT_SFX"), 2, op("RETURN")]);
        let timeline = play(&create_only(create), 2);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Sfx {
                frame: 0,
                piece: "barrel".to_string(),
                sfx: 1025
            }]
        );
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w == coilbox_unitpose::EFFECTS_NOTE));
        assert!(!timeline
            .warnings
            .iter()
            .any(|w| w.contains("not drawn in the preview")));
    }

    #[test]
    fn records_an_explosion_with_its_flags() {
        let mut create = push(257);
        create.extend([op("EXPLODE"), 1, op("RETURN")]);
        let timeline = play(&create_only(create), 2);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Explode {
                frame: 0,
                piece: "turret".to_string(),
                flags: 257
            }]
        );
    }

    /// A TA:K file names its sounds, and the index picks one.
    #[test]
    fn names_a_sound_from_the_table() {
        let mut create = push(0);
        create.extend([op("PLAY_SOUND"), 1, op("RETURN")]);
        let bytes = crate::cob::ta_kingdoms(
            build(&[("Pad", vec![0, 0]), ("Create", create)], PIECES, 0),
            &["krogtaunt", "krogdeath"],
        );
        let timeline = play(&bytes, 2);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Sound {
                frame: 0,
                name: Some("krogdeath".to_string())
            }]
        );
    }

    /// A TA file has no table, so the sound has no name and the run says which
    /// index it was.
    #[test]
    fn a_sound_with_no_table_is_recorded_without_a_name() {
        let mut create = push(0);
        create.extend([op("PLAY_SOUND"), 3, op("RETURN")]);
        let timeline = play(&create_only(create), 2);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Sound {
                frame: 0,
                name: None
            }]
        );
        assert!(
            timeline
                .warnings
                .iter()
                .any(|w| w.contains("plays sound 3")),
            "{:?}",
            timeline.warnings
        );
    }

    /// `ShowUnitScriptError` and nothing else, in the engine.
    #[test]
    fn a_piece_that_is_not_there_records_nothing() {
        let mut create = push(1025);
        create.extend([op("EMIT_SFX"), 9, op("RETURN")]);
        let timeline = play(&create_only(create), 2);

        assert!(timeline.events.is_empty());
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w.contains("emit-sfx names piece 9")));
    }

    /// The unit first, then the piece, then an operand nothing reads, which is
    /// the order the engine pops them in reverse.
    #[test]
    fn attaches_and_drops_in_the_engine_s_operand_order() {
        let mut words = vec![op("CREATE_LOCAL_VAR")];
        words.extend([op("PUSH_LOCAL_VAR"), 0]);
        words.extend(push(1));
        words.extend(push(0));
        words.push(op("ATTACH_UNIT"));
        words.extend([op("PUSH_LOCAL_VAR"), 0]);
        words.extend([op("DROP_UNIT"), op("RETURN")]);
        let timeline = pickup(&build(&[("TransportPickup", words)], PIECES, 0));

        assert_eq!(
            timeline.events,
            [
                ScriptOutput::Attach {
                    frame: 0,
                    unit: 2,
                    piece: Some("turret".to_string())
                },
                ScriptOutput::Drop { frame: 0, unit: 2 },
            ]
        );
    }

    /// `attach-unit unitid to 0 - 1` is the Hulk hiding its passenger.
    #[test]
    fn a_negative_piece_is_the_void() {
        let mut words = vec![op("CREATE_LOCAL_VAR")];
        words.extend([op("PUSH_LOCAL_VAR"), 0]);
        words.extend(push(u32::MAX));
        words.extend(push(0));
        words.extend([op("ATTACH_UNIT"), op("RETURN")]);
        let timeline = pickup(&build(&[("TransportPickup", words)], PIECES, 0));

        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach {
                frame: 0,
                unit: 2,
                piece: None
            }]
        );
    }
}

mod engine_attach {
    use super::*;
    use coilbox_unitpose::{EngineAction, ScriptOutput};

    fn scene(height: f64) -> coilbox_unitpose::World {
        coilbox_unitpose::World {
            stand_in: Some(coilbox_unitpose::StandIn {
                id: 2,
                pos: Some([30.0, 0.0, 40.0]),
                radius: 5.0,
                height,
            }),
            own: coilbox_unitpose::Size {
                radius: 10.0,
                height: 12.0,
            },
        }
    }

    fn engine(
        frame: u32,
        action: EngineAction,
        world: Option<coilbox_unitpose::World>,
    ) -> ScriptEvent {
        ScriptEvent {
            frame,
            callin: String::new(),
            args: Vec::new(),
            ambient: false,
            world,
            engine: Some(action),
        }
    }

    fn carried(bytes: &[u8], events: &[ScriptEvent]) -> Timeline {
        run(bytes, &model_pieces(), events, 6, &[], &HashMap::new())
    }

    /// `QueryTransport(piecenum, height)` claims both arguments and sets the
    /// first, which is how a COB call-in answers.
    fn answers(piece: u32) -> Vec<u8> {
        let mut words = vec![op("CREATE_LOCAL_VAR"), op("CREATE_LOCAL_VAR")];
        words.extend(push(piece));
        words.extend([op("POP_LOCAL_VAR"), 0, op("RETURN")]);
        build(&[("QueryTransport", words)], PIECES, 0)
    }

    #[test]
    fn asks_query_transport_straight_away_and_attaches_there() {
        let timeline = carried(
            &answers(1),
            &[engine(0, EngineAction::Attach, Some(scene(6.0)))],
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
        assert!(
            !timeline
                .warnings
                .iter()
                .any(|w| w.contains("QueryTransport")),
            "{:?}",
            timeline.warnings
        );
    }

    /// `CobInstance.cpp:368-370`: the passenger's height in 65536ths.
    #[test]
    fn hands_query_transport_the_height_in_65536ths() {
        let mut words = vec![op("CREATE_LOCAL_VAR"), op("CREATE_LOCAL_VAR")];
        words.extend([op("PUSH_LOCAL_VAR"), 1]);
        words.extend(push(65536));
        words.extend([op("DIV"), op("POP_LOCAL_VAR"), 0, op("RETURN")]);
        let bytes = build(&[("QueryTransport", words)], PIECES, 0);
        let timeline = carried(&bytes, &[engine(0, EngineAction::Attach, Some(scene(2.0)))]);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach {
                frame: 0,
                unit: 2,
                piece: Some("barrel".to_string())
            }]
        );
    }

    /// With no `QueryTransport` the engine's arguments are left as they were,
    /// and the first of them is the count, 2 (`CobInstance.cpp:564-579`).
    #[test]
    fn a_missing_query_transport_answers_script_piece_two() {
        let timeline = carried(
            &create_only(vec![op("RETURN")]),
            &[engine(0, EngineAction::Attach, Some(scene(6.0)))],
        );

        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach {
                frame: 0,
                unit: 2,
                piece: Some("barrel".to_string())
            }]
        );
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w.contains("no QueryTransport")));
    }

    /// A call that does not finish in one tick leaves the arguments alone too
    /// (`CobInstance.cpp:590-622`).
    #[test]
    fn a_query_transport_that_waits_answers_script_piece_two() {
        let mut words = vec![op("CREATE_LOCAL_VAR"), op("CREATE_LOCAL_VAR")];
        words.extend(push(100));
        words.push(op("SLEEP"));
        words.extend(push(0));
        words.extend([op("POP_LOCAL_VAR"), 0, op("RETURN")]);
        let bytes = build(&[("QueryTransport", words)], PIECES, 0);
        let timeline = carried(&bytes, &[engine(0, EngineAction::Attach, Some(scene(6.0)))]);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach {
                frame: 0,
                unit: 2,
                piece: Some("barrel".to_string())
            }]
        );
        assert!(timeline.warnings.iter().any(|w| w.contains("waited")));
    }

    /// `DetachUnitFromAir` (`MobileCAI.cpp:2090-2091`).
    #[test]
    fn detaches_when_the_engine_says() {
        let timeline = carried(
            &answers(1),
            &[
                engine(0, EngineAction::Attach, Some(scene(6.0))),
                engine(3, EngineAction::Detach, Some(scene(6.0))),
            ],
        );

        assert_eq!(timeline.events[1], ScriptOutput::Drop { frame: 3, unit: 2 });
    }

    #[test]
    fn needs_a_stand_in_to_carry() {
        let timeline = carried(&answers(1), &[engine(0, EngineAction::Attach, None)]);

        assert!(timeline.events.is_empty());
        assert!(timeline.warnings.iter().any(|w| w.contains("no stand-in")));
    }

    /// `BeginTransport` runs its first tick before `AttachUnit(QueryTransport(...))`
    /// asks, on a shared frame (`MobileCAI.cpp:1451-1453`, `CobInstance.cpp:593`).
    #[test]
    fn ticks_begin_transport_before_query_transport_reads_what_it_set() {
        let mut begin = push(1);
        begin.extend([op("POP_STATIC"), 0, op("RETURN")]);
        let mut query = vec![op("CREATE_LOCAL_VAR"), op("CREATE_LOCAL_VAR")];
        query.extend([op("PUSH_STATIC"), 0]);
        query.extend([op("POP_LOCAL_VAR"), 0, op("RETURN")]);
        let bytes = build(
            &[("BeginTransport", begin), ("QueryTransport", query)],
            PIECES,
            1,
        );
        let events = vec![
            ScriptEvent {
                frame: 0,
                callin: "BeginTransport".to_string(),
                args: Vec::new(),
                ambient: false,
                world: None,
                engine: None,
            },
            engine(0, EngineAction::Attach, Some(scene(6.0))),
        ];

        let timeline = carried(&bytes, &events);

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
        let mut query = vec![op("CREATE_LOCAL_VAR"), op("CREATE_LOCAL_VAR")];
        query.extend(push(1));
        query.extend([op("POP_LOCAL_VAR"), 0, op("RETURN")]);

        let mut drop = vec![op("CREATE_LOCAL_VAR"), op("CREATE_LOCAL_VAR")];
        drop.extend([op("PUSH_LOCAL_VAR"), 0]);
        drop.extend(push(2));
        drop.extend(push(0));
        drop.push(op("ATTACH_UNIT"));
        drop.push(op("RETURN"));

        let bytes = build(
            &[("QueryTransport", query), ("TransportDrop", drop)],
            PIECES,
            0,
        );
        let events = vec![
            engine(0, EngineAction::Attach, Some(scene(6.0))),
            ScriptEvent {
                frame: 3,
                callin: "TransportDrop".to_string(),
                args: vec![2.0, 0.0, 0.0, 0.0],
                ambient: false,
                world: Some(scene(6.0)),
                engine: None,
            },
            engine(3, EngineAction::Detach, Some(scene(6.0))),
        ];

        let timeline = carried(&bytes, &events);

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
    use coilbox_unitpose::{EngineAction, ScriptOutput};

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

    fn sprayed(bytes: &[u8], frames: u32, start: u32, stop: u32) -> Timeline {
        run(
            bytes,
            &model_pieces(),
            &[
                action(start, EngineAction::NanoStart),
                action(stop, EngineAction::NanoStop),
            ],
            frames,
            &[],
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

    /// `QueryNanoPiece(piecenum)` flips static 0 between 1 and 0 and answers
    /// it plus one, so barrel, turret, barrel and so on. Ends with the
    /// trailing `push(0)` a compiled function's implicit `return 0` leaves
    /// for `RETURN` to discard, so the answer already written to the
    /// argument slot survives.
    fn alternating() -> Vec<u8> {
        let mut words = vec![op("CREATE_LOCAL_VAR")];
        words.extend(push(1));
        words.extend([op("PUSH_STATIC"), 0, op("SUB"), op("POP_STATIC"), 0]);
        words.extend([op("PUSH_STATIC"), 0]);
        words.extend(push(1));
        words.extend([op("ADD"), op("POP_LOCAL_VAR"), 0]);
        words.extend(push(0));
        words.push(op("RETURN"));
        build(&[("QueryNanoPiece", words)], PIECES, 1)
    }

    #[test]
    fn sprays_from_what_query_nano_piece_answers_on_each_frame_between_start_and_stop() {
        let timeline = sprayed(&alternating(), 8, 2, 6);

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

    /// The engine seeds the call with `[1, -1]` and returns slot 0
    /// (`CobInstance.cpp:411-421`), so with no call-in it is script piece 1.
    #[test]
    fn a_missing_query_nano_piece_answers_script_piece_one() {
        let timeline = sprayed(&create_only(vec![op("RETURN")]), 3, 0, 2);

        assert_eq!(
            nano(&timeline),
            [
                (0, Some("turret".to_string())),
                (1, Some("turret".to_string()))
            ]
        );
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w.contains("no QueryNanoPiece")));
    }
}

mod engine_factory {
    use super::*;
    use coilbox_unitpose::{EngineAction, ScriptOutput};

    const INBUILDSTANCE: u32 = 5;

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

    /// Sets INBUILDSTANCE as soon as it runs.
    fn activate_now() -> Vec<u32> {
        let mut words = push(INBUILDSTANCE);
        words.extend(push(1));
        words.extend([op("SET"), op("RETURN")]);
        words
    }

    /// Sleeps one tick, standing in for an opening animation, then sets
    /// INBUILDSTANCE.
    fn activate_after_sleep() -> Vec<u32> {
        let mut words = push(33); // one tick, in ms
        words.push(op("SLEEP"));
        words.extend(push(INBUILDSTANCE));
        words.extend(push(1));
        words.extend([op("SET"), op("RETURN")]);
        words
    }

    /// Emits sfx `code` from the barrel, so a test can tell this call-in ran.
    fn emits(code: u32) -> Vec<u32> {
        let mut words = push(code);
        words.extend([op("EMIT_SFX"), 2, op("RETURN")]);
        words
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

    /// `Factory.cpp:138-151`: a script that puts its unit in build stance the
    /// moment it is asked to starts building the same frame the engine asks.
    #[test]
    fn building_starts_on_the_frame_the_script_sets_build_stance() {
        let bytes = build(
            &[("Activate", activate_now()), ("StartBuilding", emits(42))],
            PIECES,
            0,
        );
        let events = vec![callin(0, "Activate"), action(0, EngineAction::FactoryBuild)];
        let timeline = run(&bytes, &model_pieces(), &events, 4, &[], &HashMap::new());

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
        let bytes = build(
            &[("Activate", activate_now()), ("StartBuilding", emits(42))],
            PIECES,
            0,
        );
        let events = vec![action(0, EngineAction::FactoryBuild), callin(0, "Activate")];
        let timeline = run(&bytes, &model_pieces(), &events, 4, &[], &HashMap::new());

        assert_eq!(timeline.error, None);
        assert_eq!(build_start_frames(&timeline), [0]);
        assert_eq!(sfx_frames(&timeline, 42), [0]);
        assert!(nano_frames(&timeline).contains(&0));
    }

    /// A script that sleeps first, standing in for an opening animation, only
    /// starts building once it actually sets the stance.
    #[test]
    fn building_waits_for_an_opening_animation_before_starting() {
        let bytes = build(
            &[
                ("Activate", activate_after_sleep()),
                ("StartBuilding", emits(42)),
            ],
            PIECES,
            0,
        );
        let events = vec![callin(0, "Activate"), action(0, EngineAction::FactoryBuild)];
        let timeline = run(&bytes, &model_pieces(), &events, 5, &[], &HashMap::new());

        assert_eq!(timeline.error, None);
        assert_eq!(build_start_frames(&timeline), [3]);
        assert_eq!(sfx_frames(&timeline, 42), [3]);
        assert_eq!(nano_frames(&timeline), [3, 4]);
    }

    /// The script never sets INBUILDSTANCE, so the factory never builds, and
    /// `factory-finish` says so rather than firing `StopBuilding`.
    #[test]
    fn a_script_that_never_sets_build_stance_never_builds() {
        let bytes = build(&[("Activate", vec![op("RETURN")])], PIECES, 0);
        let events = vec![
            callin(0, "Activate"),
            action(0, EngineAction::FactoryBuild),
            action(3, EngineAction::FactoryFinish),
        ];
        let timeline = run(&bytes, &model_pieces(), &events, 4, &[], &HashMap::new());

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
        let bytes = build(&[("StartBuilding", emits(42))], PIECES, 0);
        let events = vec![action(2, EngineAction::FactoryBuild)];
        let values = HashMap::from([(INBUILDSTANCE as i32, 1)]);
        let timeline = run(&bytes, &model_pieces(), &events, 4, &[], &values);

        assert_eq!(timeline.error, None);
        assert_eq!(build_start_frames(&timeline), [2]);
        assert_eq!(sfx_frames(&timeline, 42), [2]);
    }

    /// `factory-finish` stops the spraying and runs `StopBuilding`.
    #[test]
    fn factory_finish_stops_spraying_and_runs_stop_building() {
        let bytes = build(
            &[
                ("Activate", activate_now()),
                ("StartBuilding", emits(42)),
                ("StopBuilding", emits(99)),
            ],
            PIECES,
            0,
        );
        let events = vec![
            callin(0, "Activate"),
            action(0, EngineAction::FactoryBuild),
            action(3, EngineAction::FactoryFinish),
        ];
        let timeline = run(&bytes, &model_pieces(), &events, 6, &[], &HashMap::new());

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

    /// `get UNIT_Y(2, 0, 0, 0)` then move `piece` along z by it, the same
    /// smuggling trick `reads_y_of_the_passenger` in `what_it_says_about_itself`
    /// uses to get a queried number out where a test can read it.
    fn reads_y_of_the_stand_in(piece: u32) -> Vec<u32> {
        let mut words = push(10); // UNIT_Y
        words.extend(push(2)); // the stand-in's id, as p1
        words.extend(push(0)); // p2
        words.extend(push(0)); // p3
        words.extend(push(0)); // p4
        words.push(op("GET"));
        words.extend([op("MOVE_NOW"), piece, 2, op("RETURN")]);
        words
    }

    /// The world handed to `Run` before it starts already carries the stand-in
    /// on its build piece's rest position, because the preview cannot know the
    /// run's own `build-start` frame ahead of time. But the buildee itself does
    /// not exist until the script actually reaches build stance, so a question
    /// asked while `awaiting_build` reads as though there were no stand-in at
    /// all, the same world data notwithstanding. Once building starts, the
    /// same question reads the real position.
    #[test]
    fn hides_the_stand_in_from_the_world_while_awaiting_build_stance() {
        let bytes = build(
            &[
                ("Activate", activate_after_sleep()),
                ("ProbeBefore", reads_y_of_the_stand_in(0)),
                ("ProbeAfter", reads_y_of_the_stand_in(1)),
            ],
            PIECES,
            0,
        );
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
        let timeline = run(&bytes, &model_pieces(), &events, 6, &[], &HashMap::new());

        assert_eq!(timeline.error, None);
        // Confirms the probes land either side of build-start.
        assert_eq!(build_start_frames(&timeline), [3]);
        assert!(close(pose(&timeline, 1, "base")[2], 0.0));
        assert!(close(pose(&timeline, 4, "turret")[2], 3.0));
    }
}

mod engine_fire {
    use super::*;
    use coilbox_unitpose::{EngineAction, ScriptOutput};
    use std::path::Path;

    fn compile(source: &str) -> Vec<u8> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../coilbox-bos2lua/tests/fixtures");
        crate::compile_bos(source, &dir).unwrap()
    }

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

    fn fired(bytes: &[u8], events: &[ScriptEvent], frames: u32) -> Timeline {
        let mut all = created();
        all.extend_from_slice(events);
        run(bytes, &model_pieces(), &all, frames, &[], &HashMap::new())
    }

    fn hidden(timeline: &Timeline, frame: usize, piece: &str) -> bool {
        let index = timeline.pieces.iter().position(|p| p == piece).unwrap();
        timeline.hidden[frame][index]
    }

    const GUN: &str = r#"
        piece base, turret, barrel;
        Create() { hide barrel; }
        QueryWeapon1(piecenum) { piecenum = barrel; }
        AimFromWeapon1(piecenum) { piecenum = turret; }
        FirePrimary() { show barrel; }
        Shot1(zero) { show turret; }
    "#;

    /// `show` inside a fire function draws a flare and leaves the piece
    /// hidden (`CobThread.cpp:715-728`). Anywhere else it unhides.
    #[test]
    fn show_in_a_fire_function_records_a_flare_and_leaves_the_piece_hidden() {
        let timeline = fired(&compile(GUN), &[fire(5, 1.0)], 8);

        assert_eq!(timeline.error, None);
        assert!(timeline.events.contains(&ScriptOutput::Flare {
            frame: 5,
            piece: "barrel".into()
        }));
        assert!(hidden(&timeline, 7, "barrel"));
    }

    /// `Shot1` is not a fire function, so its `show` unhides.
    #[test]
    fn show_outside_a_fire_function_still_unhides() {
        let source = GUN.replace("show turret", "hide turret; show turret");
        let timeline = fired(&compile(&source), &[fire(5, 1.0)], 8);

        assert!(!hidden(&timeline, 7, "turret"));
        assert!(!timeline
            .events
            .iter()
            .any(|e| matches!(e, ScriptOutput::Flare { piece, .. } if piece == "turret")));
    }

    /// A function a fire function calls is not itself a fire function: the
    /// engine checks the innermost call frame.
    #[test]
    fn show_in_a_function_called_from_a_fire_function_unhides() {
        let source = r#"
            piece base, turret, barrel;
            Create() { hide barrel; }
            Flash() { show barrel; }
            FireWeapon1() { call-script Flash(); }
        "#;
        let timeline = fired(&compile(source), &[fire(5, 1.0)], 8);

        assert!(!hidden(&timeline, 7, "barrel"));
        assert!(!timeline
            .events
            .iter()
            .any(|e| matches!(e, ScriptOutput::Flare { .. })));
    }

    /// `FireWeapon`, then `Shot`, then `QueryWeapon`, on the one frame
    /// (`Weapon.cpp:509-511,590-595`). The shot names what `QueryWeapon1`
    /// answered after `Shot1` ran.
    #[test]
    fn fire_calls_fire_then_shot_then_query_weapon_on_its_frame() {
        let source = r#"
            piece base, turret, barrel;
            static-var muzzle;
            Create() { muzzle = turret; }
            FireWeapon1() { muzzle = base; }
            Shot1(zero) { muzzle = barrel; }
            QueryWeapon1(piecenum) { piecenum = muzzle; }
        "#;
        let timeline = fired(&compile(source), &[fire(5, 1.0)], 8);

        assert_eq!(
            timeline
                .events
                .iter()
                .filter(|e| matches!(e, ScriptOutput::Shot { .. }))
                .cloned()
                .collect::<Vec<_>>(),
            [ScriptOutput::Shot {
                frame: 5,
                weapon: 1,
                piece: Some("barrel".into())
            }]
        );
    }

    /// A missing `QueryWeapon` answers script piece 1, as the engine's seed
    /// leaves it (`CobInstance.cpp:437-446`).
    #[test]
    fn a_missing_query_weapon_answers_script_piece_one() {
        let source = "piece base, turret, barrel;\nCreate() { }\n";
        let timeline = fired(&compile(source), &[fire(5, 1.0)], 8);

        assert!(timeline.events.contains(&ScriptOutput::Shot {
            frame: 5,
            weapon: 1,
            piece: Some("turret".into())
        }));
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w.contains("no QueryWeapon1")));
    }

    /// The weapon number picks the call-ins: weapon 2 runs `FireWeapon2`.
    #[test]
    fn the_weapon_number_picks_the_call_ins() {
        let source = r#"
            piece base, turret, barrel;
            Create() { hide barrel; hide turret; }
            FireWeapon1() { show turret; }
            FireWeapon2() { show barrel; }
            QueryWeapon2(piecenum) { piecenum = barrel; }
        "#;
        let timeline = fired(&compile(source), &[fire(5, 2.0)], 8);

        assert!(timeline.events.contains(&ScriptOutput::Flare {
            frame: 5,
            piece: "barrel".into()
        }));
        assert!(!timeline
            .events
            .iter()
            .any(|e| matches!(e, ScriptOutput::Flare { piece, .. } if piece == "turret")));
    }
}
