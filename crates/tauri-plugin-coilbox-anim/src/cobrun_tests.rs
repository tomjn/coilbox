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
    }]
}

fn play(bytes: &[u8], frames: u32) -> Timeline {
    run(bytes, &model_pieces(), &created(), frames)
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
            },
            ScriptEvent {
                frame: 1,
                callin: "StartMoving".to_string(),
                args: Vec::new(),
            },
        ];

        let timeline = run(&bytes, &model_pieces(), &events, 3);

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
        let timeline = run(b"not a cob", &model_pieces(), &created(), 5);

        assert!(timeline.error.is_some());
        assert!(timeline.frames.is_empty());
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
            }],
            3,
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
            }],
            3,
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
            }],
            3,
        );

        // Radians into COB units and back out through the distance scale is the
        // angle as a fraction of a full circle.
        let expected = 0.8 / std::f64::consts::TAU;
        assert!((pose(&timeline, 0, "base")[2] - expected).abs() < 1e-4);
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

    #[test]
    fn stops_on_an_instruction_word_that_is_not_an_opcode() {
        let code = vec![0xDEAD_BEEF, op("RETURN")];

        let timeline = play(&create_only(code), 3);

        assert!(timeline.error.as_deref().unwrap_or("").contains("deadbeef"));
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
}
