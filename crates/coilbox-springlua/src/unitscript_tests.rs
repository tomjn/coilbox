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
    }]
}

fn play(script: &str, frames: u32) -> Timeline {
    run(script, "test.lua", &pieces(), &create(), frames)
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
        &pieces(),
        &[
            ScriptEvent {
                frame: 0,
                callin: "Create".to_string(),
                args: Vec::new(),
            },
            ScriptEvent {
                frame: 10,
                callin: "StopMoving".to_string(),
                args: Vec::new(),
            },
        ],
        60,
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
        &pieces(),
        &[ScriptEvent {
            frame: 0,
            callin: "AimWeapon1".to_string(),
            args: vec![0.75, 0.1],
        }],
        3,
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
        &pieces(),
        &[
            ScriptEvent {
                frame: 0,
                callin: "Create".to_string(),
                args: Vec::new(),
            },
            ScriptEvent {
                frame: 0,
                callin: "StartMoving".to_string(),
                args: Vec::new(),
            },
            ScriptEvent {
                frame: 60,
                callin: "StopMoving".to_string(),
                args: Vec::new(),
            },
        ],
        120,
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

#[test]
fn a_throwing_call_in_names_it_and_keeps_the_frames_before_it() {
    let timeline = run(
        r#"
        local turret = piece("turret")
        function script.Create() Turn(turret, y_axis, 1.0) end
        function script.StartMoving() error("no") end
        "#,
        "test.lua",
        &pieces(),
        &[
            ScriptEvent {
                frame: 0,
                callin: "Create".to_string(),
                args: Vec::new(),
            },
            ScriptEvent {
                frame: 5,
                callin: "StartMoving".to_string(),
                args: Vec::new(),
            },
        ],
        30,
    );
    let error = timeline.error.expect("a throwing call-in fails");
    assert!(error.contains("StartMoving"), "{error}");
    assert_eq!(timeline.frames.len(), 5);
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
        &pieces(),
        &[ScriptEvent {
            frame: 0,
            callin: "StartMoving".to_string(),
            args: Vec::new(),
        }],
        5,
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
        local flare = piece("flare")
        function script.Create() EmitSfx(flare, 1024) end
        "#,
        3,
    );
    assert_eq!(timeline.error, None);
    assert!(
        timeline
            .warnings
            .iter()
            .any(|note| note.contains("EmitSfx")),
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
        let timeline = play(&format!("function script.Create() {hatch}() end"), 3);
        let error = timeline.error.expect("the sandbox holds");
        assert!(error.contains(hatch), "{error}");
    }
}
