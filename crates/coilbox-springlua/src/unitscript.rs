//! Run a Recoil unit script for a fixed number of frames and report the pose
//! its pieces are in on each one.
//!
//! A unit script is not config: it returns nothing, calls `piece(...)` at the
//! top level and expects the engine to call it back later, from threads that
//! `Sleep`. So it cannot be evaluated and read off the way [`SpringLua`] reads
//! a `mapinfo.lua`. It has to be driven a frame at a time, with a scheduler
//! resuming its threads and an animation tick moving its pieces between them.
//!
//! That is what this module is. It shares the crate's Lua VM (mlua, Lua 5.1)
//! and nothing else: its own sandbox, its own globals, its own instruction cap.
//! It lives here rather than in a sibling crate because mlua is vendored once
//! and one place to keep the Lua version honest is worth more than the tidier
//! boundary.
//!
//! What it is for: previewing a unit's own script in the builder's viewport.
//! It is not the engine and does not try to be. It moves pieces, hides them and
//! runs threads. Weapons, world state, terrain, damage and sound are absent, and
//! anything a script asks for that is not here is reported rather than faked.
//!
//! [`SpringLua`]: crate::SpringLua

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use mlua::{Function, Lua, LuaOptions, MultiValue, StdLib, Table, Thread, ThreadStatus, Value};
use serde::{Deserialize, Serialize};

/// Sim frames per second. The engine's `GAME_SPEED`, which every `Sleep` and
/// every per-second speed is measured against.
pub const FPS: u32 = 30;

/// Seconds of sim per frame, which every per-second speed is divided by.
const DT: f64 = 1.0 / FPS as f64;

/// Milliseconds a frame lasts as far as a script is concerned. 33, not 33.33:
/// the engine passes `1000 / GAME_SPEED` as an integer, so a script's clock runs
/// 990ms to the second and a `Sleep` is measured in these.
const TICK_MS: f64 = 33.0;

/// Instructions one frame may execute before the run is abandoned.
///
/// Refilled at the start of each frame, so this is a per-frame budget rather
/// than a budget for the whole run: a script that loops without sleeping is
/// caught on the frame it does it, and a long run of well behaved frames is
/// never punished for its length. Generous enough that no plausible per-frame
/// script work comes close.
const FRAME_INSTRUCTIONS: i64 = 2_000_000;

/// How often the VM stops to check the budget. Lua counts instructions per
/// thread and a script's work is spread across threads, so the count that
/// matters is kept on this side and this is only how often it is looked at.
const HOOK_EVERY: u32 = 100_000;

/// Most frames one run may simulate: 30 seconds. A preview loops, so more than
/// this buys nothing and costs memory in the timeline.
pub const MAX_FRAMES: u32 = FPS * 30;

/// Most threads that may exist at once. A script that starts a thread per frame
/// is a bug, and without a ceiling it is a hang.
const MAX_THREADS: usize = 256;

/// Base-library functions that can execute arbitrary strings or escape the
/// environment. Removed for the same reason [`crate::SpringLua`] removes them.
const EXEC_HATCHES: &[&str] = &[
    "dofile",
    "loadfile",
    "loadstring",
    "load",
    "getfenv",
    "setfenv",
];

/// A call-in to fire at a given frame, which is how a scenario is expressed.
///
/// A script animates in response to events, so a preview has to choose what
/// happens to the unit. The choosing is the caller's: it knows the wording the
/// user picked from and can expand "fires every two seconds" into the events it
/// means. This side only runs them.
#[derive(Debug, Clone, Deserialize)]
pub struct ScriptEvent {
    /// Frame to fire on, counted from 0.
    pub frame: u32,
    /// Key in the script's `script` table, such as `Create` or `AimWeapon1`.
    pub callin: String,
    /// Numeric arguments, for the call-ins that take them.
    #[serde(default)]
    pub args: Vec<f64>,
}

/// Every piece's pose on every frame, which is what the viewport plays.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub fps: u32,
    /// Piece names, in the order every frame's numbers are laid out.
    pub pieces: Vec<String>,
    /// One entry per frame simulated: `pieces.len() * 6` numbers, six per piece,
    /// being x, y, z offset from the rest pose then x, y, z rotation in radians.
    ///
    /// The rotations compose in the order the engine composes them, which is y,
    /// then x, then z. Whatever draws these has to say so.
    pub frames: Vec<Vec<f64>>,
    /// One flag per piece per frame, or empty when the script never hid
    /// anything. Empty is the common case and worth not paying for.
    pub hidden: Vec<Vec<bool>>,
    /// What stopped the run, or none if it ran to the end. The frames before it
    /// are still here and still worth playing: where a script gets to before it
    /// fails is most of what says why.
    pub error: Option<String>,
    /// Things the run wants to say that did not stop it: a call-in the script
    /// does not define, a call the preview cannot honour.
    pub warnings: Vec<String>,
}

impl Timeline {
    /// A run that produced nothing, because it could not start.
    fn failed(pieces: &[String], error: String) -> Self {
        Self {
            fps: FPS,
            pieces: pieces.to_vec(),
            frames: Vec::new(),
            hidden: Vec::new(),
            error: Some(error),
            warnings: Vec::new(),
        }
    }
}

/// A rotation in progress on one axis of one piece.
///
/// One or the other, never both: the engine keeps a single turn and a single
/// spin per piece and axis, and starting either removes the other
/// (`CUnitScript::AddAnim`).
#[derive(Debug, Clone, Copy)]
enum Rotate {
    /// Toward `dest` at `speed` radians per second, then stop.
    Turn { dest: f64, speed: f64 },
    /// Continuously, at `speed` radians per second, changing that speed by
    /// `accel` radians per second on every frame until it reaches `target`. An
    /// `accel` of zero means `speed` is already `target`.
    Spin { speed: f64, target: f64, accel: f64 },
}

/// A translation in progress on one axis of one piece.
#[derive(Debug, Clone, Copy)]
struct Translate {
    dest: f64,
    speed: f64,
}

#[derive(Debug, Clone)]
struct Piece {
    name: String,
    /// Offset from the rest pose, in elmos, per axis.
    pos: [f64; 3],
    /// Rotation about the piece's own origin, in radians, per axis.
    rot: [f64; 3],
    hidden: bool,
    rotate: [Option<Rotate>; 3],
    translate: [Option<Translate>; 3],
}

impl Piece {
    fn new(name: String) -> Self {
        Self {
            name,
            pos: [0.0; 3],
            rot: [0.0; 3],
            hidden: false,
            rotate: [None; 3],
            translate: [None; 3],
        }
    }
}

/// Which kind of animation a thread is waiting on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Wait {
    Turn,
    Move,
}

/// Everything the Lua-facing functions read or write. Shared with them through
/// an `Rc<RefCell<_>>`, so every borrow is short and none is held across a call
/// back into Lua.
#[derive(Debug, Default)]
struct Sim {
    pieces: Vec<Piece>,
    /// True once anything has been hidden, shown or exploded, which is what
    /// decides whether the timeline carries visibility at all.
    visibility_used: bool,
    /// Threads a running thread asked for. Started before the frame ends.
    spawned: Vec<(Thread, Vec<Value>)>,
    /// Signal masks the running thread raised while it was running.
    signalled: Vec<u32>,
    /// The mask the running thread set for itself, if it did.
    mask: Option<u32>,
    warnings: Vec<String>,
}

impl Sim {
    fn piece(&mut self, piece: i64) -> mlua::Result<&mut Piece> {
        piece_index(self, piece).map(move |index| &mut self.pieces[index])
    }

    fn note(&mut self, note: String) {
        if !self.warnings.contains(&note) {
            self.warnings.push(note);
        }
    }
}

/// One of the script's threads: a call-in the preview fired, or something a
/// `StartThread` started.
struct Runner {
    thread: Thread,
    /// Arguments for the first resume, taken when it happens.
    args: Vec<Value>,
    state: State,
    /// The mask set with `SetSignalMask`, which is what `Signal` kills by.
    mask: u32,
    /// What started it, so an error can say which call-in was to blame.
    origin: String,
}

enum State {
    /// Resume as soon as the scheduler gets to it.
    Ready,
    /// Resume once the frame counter reaches this.
    Sleeping(u32),
    /// Resume once this piece's animation on this axis finishes.
    Waiting {
        piece: usize,
        axis: usize,
        kind: Wait,
    },
    Dead,
}

/// Run `script` for `frames` frames, firing `events` as they come due, and
/// report the pose of every piece on every frame.
///
/// `pieces` is the unit's piece names: what `piece("name")` resolves against,
/// and the order the timeline's numbers are laid out in. A script naming a
/// piece the unit does not have fails here, exactly as it fails at load in the
/// engine, and says which name.
///
/// Never returns an error. A script that will not compile, names a missing
/// piece, throws, or loops without sleeping comes back as a [`Timeline`] with
/// `error` set and whatever frames it managed. Failing is an outcome of running
/// a script, not a failure to run one.
pub fn run(
    script: &str,
    name: &str,
    pieces: &[String],
    events: &[ScriptEvent],
    frames: u32,
) -> Timeline {
    match Run::start(script, name, pieces) {
        Ok(mut run) => run.play(events, frames.min(MAX_FRAMES)),
        Err(error) => Timeline::failed(pieces, error),
    }
}

struct Run {
    lua: Lua,
    sim: Rc<RefCell<Sim>>,
    /// Instructions left in this frame, counted down by the VM's hook.
    budget: Rc<Cell<i64>>,
    script: Table,
    runners: Vec<Runner>,
    frame: u32,
}

impl Run {
    /// Build the VM, install the unit script API and execute the chunk's top
    /// level, which is where its `piece(...)` calls and `script.X` definitions
    /// happen.
    fn start(script: &str, name: &str, pieces: &[String]) -> Result<Self, String> {
        let sim = Rc::new(RefCell::new(Sim {
            pieces: pieces.iter().cloned().map(Piece::new).collect(),
            ..Sim::default()
        }));
        let budget = Rc::new(Cell::new(FRAME_INSTRUCTIONS));
        let lua =
            sandbox(&sim, &budget).map_err(|e| format!("could not build the Lua sandbox: {e}"))?;
        let table: Table = lua
            .globals()
            .get("script")
            .map_err(|e| format!("could not read the script table: {e}"))?;

        lua.load(script)
            .set_name(name)
            .exec()
            .map_err(|e| describe(&e))?;

        Ok(Self {
            lua,
            sim,
            budget,
            script: table,
            runners: Vec::new(),
            frame: 0,
        })
    }

    fn play(&mut self, events: &[ScriptEvent], frames: u32) -> Timeline {
        let mut timeline = Timeline {
            fps: FPS,
            pieces: self
                .sim
                .borrow()
                .pieces
                .iter()
                .map(|piece| piece.name.clone())
                .collect(),
            frames: Vec::with_capacity(frames as usize),
            hidden: Vec::new(),
            error: None,
            warnings: Vec::new(),
        };

        for frame in 0..frames {
            self.frame = frame;
            if let Err(error) = self.step(events) {
                timeline.error = Some(error);
                break;
            }
            self.sample(&mut timeline);
        }

        let sim = self.sim.borrow();
        timeline.warnings.extend(sim.warnings.iter().cloned());
        if !sim.visibility_used {
            timeline.hidden.clear();
        }
        timeline
    }

    /// One frame: tick the animations, wake what they finished, fire what is
    /// due, then run every thread that can run.
    ///
    /// Animations tick before threads run, so a `Turn` issued this frame first
    /// moves on the next one. That is the engine's order, and it is what makes
    /// a `Sleep` cost time rather than nothing.
    fn step(&mut self, events: &[ScriptEvent]) -> Result<(), String> {
        self.budget.set(FRAME_INSTRUCTIONS);
        self.tick_animations();
        self.wake_finished();
        self.fire_due(events)?;
        self.run_threads()
    }

    fn tick_animations(&mut self) {
        let mut sim = self.sim.borrow_mut();
        for piece in &mut sim.pieces {
            for axis in 0..3 {
                if let Some(rotate) = piece.rotate[axis] {
                    piece.rotate[axis] = tick_rotate(&mut piece.rot[axis], rotate);
                }
                if let Some(translate) = piece.translate[axis] {
                    piece.translate[axis] = tick_translate(&mut piece.pos[axis], translate);
                }
            }
        }
    }

    /// Anything waiting on an animation that is no longer running is ready.
    ///
    /// A wait on an axis with nothing on it is satisfied at once, which is what
    /// the engine does and what stops a `WaitForTurn` on a turn that already
    /// finished from hanging the thread forever.
    fn wake_finished(&mut self) {
        let sim = self.sim.borrow();
        for runner in &mut self.runners {
            let State::Waiting { piece, axis, kind } = runner.state else {
                continue;
            };
            // A spin started on the axis a thread was waiting to finish turning
            // wakes it, because the spin removed the turn it was waiting on.
            let still_going = sim.pieces.get(piece).is_some_and(|piece| match kind {
                Wait::Turn => matches!(piece.rotate[axis], Some(Rotate::Turn { .. })),
                Wait::Move => piece.translate[axis].is_some(),
            });
            if !still_going {
                runner.state = State::Ready;
            }
        }
    }

    fn fire_due(&mut self, events: &[ScriptEvent]) -> Result<(), String> {
        let frame = self.frame;
        for event in events.iter().filter(|event| event.frame == frame) {
            let function: Option<Function> = self.script.get(event.callin.as_str()).ok().flatten();
            let Some(function) = function else {
                self.sim
                    .borrow_mut()
                    .note(format!("This script has no {} call-in.", event.callin));
                continue;
            };
            let thread = self
                .lua
                .create_thread(function)
                .map_err(|e| format!("could not start {}: {e}", event.callin))?;
            self.add_runner(
                thread,
                event.args.iter().map(|arg| Value::Number(*arg)).collect(),
                event.callin.clone(),
            )?;
        }
        Ok(())
    }

    fn add_runner(
        &mut self,
        thread: Thread,
        args: Vec<Value>,
        origin: String,
    ) -> Result<(), String> {
        if self.runners.iter().filter(|r| !r.is_dead()).count() >= MAX_THREADS {
            return Err(format!(
                "this script has more than {MAX_THREADS} threads running at once"
            ));
        }
        self.runners.push(Runner {
            thread,
            args,
            state: State::Ready,
            mask: 0,
            origin,
        });
        Ok(())
    }

    /// Resume every ready thread, then anything they started or woke, until
    /// nothing is left that can run this frame.
    fn run_threads(&mut self) -> Result<(), String> {
        // A thread that yields ready again, on a wait that is already satisfied,
        // would spin here forever without a ceiling. Every pass has to make
        // progress or stop. Well clear of the thread ceiling, so a script that
        // trips both is told about the threads, which is the truer answer.
        for _ in 0..MAX_THREADS * 4 {
            let Some(index) = self.next_ready() else {
                return Ok(());
            };
            self.resume(index)?;
        }
        Err("this frame's threads never settled: one is waiting on itself".to_string())
    }

    fn next_ready(&self) -> Option<usize> {
        self.runners.iter().position(|runner| match runner.state {
            State::Ready => true,
            State::Sleeping(frame) => frame <= self.frame,
            _ => false,
        })
    }

    fn resume(&mut self, index: usize) -> Result<(), String> {
        let args = std::mem::take(&mut self.runners[index].args);
        // Dead before the resume, so a thread that finishes without yielding is
        // not left looking runnable.
        self.runners[index].state = State::Dead;

        let yielded: MultiValue = self.runners[index]
            .thread
            .resume(MultiValue::from_iter(args))
            .map_err(|error| format!("{}: {}", self.runners[index].origin, describe(&error)))?;

        self.apply_side_effects(index)?;

        if self.runners[index].thread.status() != ThreadStatus::Resumable {
            return Ok(());
        }
        self.runners[index].state = self.read_yield(index, yielded)?;
        Ok(())
    }

    /// Take up what the resumed thread asked for while it was running: threads
    /// to start, signals to raise, a mask of its own.
    ///
    /// A signal kills every other thread carrying that mask. Not the thread that
    /// raised it: `Signal(SIG)` followed by `SetSignalMask(SIG)` is the standard
    /// way a call-in stops the last copy of itself, and it has to survive its
    /// own signal for that to work.
    fn apply_side_effects(&mut self, index: usize) -> Result<(), String> {
        let (spawned, signalled, mask) = {
            let mut sim = self.sim.borrow_mut();
            (
                std::mem::take(&mut sim.spawned),
                std::mem::take(&mut sim.signalled),
                sim.mask.take(),
            )
        };
        for signal in signalled {
            for (other, runner) in self.runners.iter_mut().enumerate() {
                if other != index && runner.mask & signal != 0 {
                    runner.state = State::Dead;
                }
            }
        }
        if let Some(mask) = mask {
            self.runners[index].mask = mask;
        }
        for (thread, args) in spawned {
            let origin = self.runners[index].origin.clone();
            self.add_runner(thread, args, origin)?;
        }
        Ok(())
    }

    /// What a yield from the API's Lua wrappers means. Anything else is a
    /// script calling `coroutine.yield` itself, which the engine has no answer
    /// for either. Treat it as a sleep of one frame so it cannot hang.
    fn read_yield(&self, index: usize, yielded: MultiValue) -> Result<State, String> {
        let mut values = yielded.into_iter();
        let kind = match values.next() {
            Some(Value::String(kind)) => kind.to_string_lossy(),
            _ => return Ok(State::Sleeping(self.frame + 1)),
        };
        match kind.as_str() {
            "sleep" => {
                // The engine's own rule, from the unit script gadget: a frame is
                // 33ms, the division floors, and a sleep is never shorter than
                // one frame. `Sleep(50)` is one frame, not two.
                let ms = number(values.next()).max(0.0);
                let frames = (ms / TICK_MS).floor().max(1.0) as u32;
                Ok(State::Sleeping(self.frame + frames))
            }
            "turn" | "move" => {
                let piece = number(values.next()) as i64;
                let axis = number(values.next()) as i64;
                let origin = &self.runners[index].origin;
                let named = piece;
                let piece = usize::try_from(piece - 1)
                    .ok()
                    .filter(|piece| *piece < self.sim.borrow().pieces.len())
                    .ok_or_else(|| format!("{origin}: waited on {named}, which is not a piece"))?;
                let axis = axis_index(axis).ok_or_else(|| {
                    format!("{origin}: waited on axis {axis}, which is not an axis")
                })?;
                Ok(State::Waiting {
                    piece,
                    axis,
                    kind: if kind == "turn" {
                        Wait::Turn
                    } else {
                        Wait::Move
                    },
                })
            }
            _ => Ok(State::Sleeping(self.frame + 1)),
        }
    }

    fn sample(&self, timeline: &mut Timeline) {
        let sim = self.sim.borrow();
        let mut frame = Vec::with_capacity(sim.pieces.len() * 6);
        let mut hidden = Vec::with_capacity(sim.pieces.len());
        for piece in &sim.pieces {
            frame.extend_from_slice(&piece.pos);
            frame.extend_from_slice(&piece.rot);
            hidden.push(piece.hidden);
        }
        timeline.frames.push(frame);
        timeline.hidden.push(hidden);
    }
}

impl Runner {
    fn is_dead(&self) -> bool {
        matches!(self.state, State::Dead)
    }
}

/// Move one axis one frame toward its target, and report the animation that is
/// left, which is none once it arrives.
///
/// A turn takes the shortest way round, as `CUnitScript::TurnToward` does, so a
/// piece at 0.1 told to turn to 6.2 goes backwards past zero rather than nearly
/// all the way round.
fn tick_rotate(value: &mut f64, animation: Rotate) -> Option<Rotate> {
    match animation {
        Rotate::Turn { dest, speed } => {
            let step = speed.abs() * DT;
            let delta = shortest(dest - clamp_rad(*value));
            if delta.abs() <= step {
                *value = dest;
                return None;
            }
            *value = clamp_rad(clamp_rad(*value) + delta.signum() * step);
            Some(animation)
        }
        Rotate::Spin {
            speed,
            target,
            accel,
        } => {
            // Acceleration is per frame rather than per second: the engine
            // scales it by `GAME_SPEED / tickRate`, and those are the same
            // number, so a spin gains `accel` radians per second every frame.
            let reached = (target - speed).abs() <= accel;
            let speed = if reached {
                target
            } else {
                speed + (target - speed).signum() * accel
            };
            *value = clamp_rad(*value + speed * DT);
            // Only a spin that has arrived at a target of nothing is over. One
            // passing through zero on its way to a speed the other way is not.
            if reached && speed == 0.0 {
                return None;
            }
            Some(Rotate::Spin {
                speed,
                target,
                accel,
            })
        }
    }
}

fn tick_translate(value: &mut f64, animation: Translate) -> Option<Translate> {
    let step = animation.speed.abs() * DT;
    if (animation.dest - *value).abs() <= step {
        *value = animation.dest;
        return None;
    }
    *value += (animation.dest - *value).signum() * step;
    Some(animation)
}

/// An angle in `[0, TAU)`, which is the range the engine keeps piece rotations
/// in and what stops a long spin drifting out of a float's precision.
fn clamp_rad(angle: f64) -> f64 {
    let tau = std::f64::consts::TAU;
    angle - tau * (angle / tau).floor()
}

/// The way round from one angle to another that is not the long way: the result
/// is in `(-PI, PI]`.
fn shortest(delta: f64) -> f64 {
    let tau = std::f64::consts::TAU;
    (delta + 3.0 * std::f64::consts::PI).rem_euclid(tau) - std::f64::consts::PI
}

/// A number a yield carried, whichever of Lua's two number shapes it arrived in.
fn number(value: Option<Value>) -> f64 {
    match value {
        Some(Value::Integer(number)) => number as f64,
        Some(Value::Number(number)) => number,
        _ => 0.0,
    }
}

/// The axis a script named, as an index into a piece's three.
///
/// Lua's `x_axis`, `y_axis` and `z_axis` are 1, 2 and 3. The engine's own
/// arrays are 0, 1 and 2, and it subtracts one on the way in.
fn axis_index(axis: i64) -> Option<usize> {
    (1..=3).contains(&axis).then_some(axis as usize - 1)
}

/// Turn an mlua error into something worth putting in front of a user: the
/// message and the line, without the Rust-side callback wrapping.
fn describe(error: &mlua::Error) -> String {
    let text = match error {
        mlua::Error::CallbackError { cause, .. } => describe(cause),
        mlua::Error::RuntimeError(message) | mlua::Error::SyntaxError { message, .. } => {
            message.clone()
        }
        other => other.to_string(),
    };
    text.split("\nstack traceback:")
        .next()
        .unwrap_or(&text)
        .trim()
        .to_string()
}

/// Build the VM and install everything a unit script expects to find.
fn sandbox(sim: &Rc<RefCell<Sim>>, budget: &Rc<Cell<i64>>) -> mlua::Result<Lua> {
    let lua = Lua::new_with(
        StdLib::TABLE | StdLib::STRING | StdLib::MATH,
        LuaOptions::default(),
    )?;

    // A global hook rather than a plain one, because Lua counts instructions per
    // thread and every call-in is a thread. Set before any of them exist, since
    // only threads made afterwards pick it up.
    let left = Rc::clone(budget);
    lua.set_global_hook(
        mlua::HookTriggers::new().every_nth_instruction(HOOK_EVERY),
        move |_lua, _debug| {
            let remaining = left.get() - i64::from(HOOK_EVERY);
            left.set(remaining);
            if remaining < 0 {
                return Err(mlua::Error::RuntimeError(
                    "this frame ran too long: a thread is looping without a Sleep".into(),
                ));
            }
            Ok(mlua::VmState::Continue)
        },
    )?;

    let globals = lua.globals();
    for name in EXEC_HATCHES {
        globals.set(*name, Value::Nil)?;
    }

    globals.set("x_axis", 1)?;
    globals.set("y_axis", 2)?;
    globals.set("z_axis", 3)?;
    globals.set("script", lua.create_table()?)?;
    globals.set("Spring", lua.create_table()?)?;
    globals.set("SFX", sfx_table(&lua)?)?;

    install_pieces(&lua, sim)?;
    install_motion(&lua, sim)?;
    install_threading(&lua, sim)?;
    install_stubs(&lua, sim)?;
    bootstrap(&lua)?;
    Ok(lua)
}

/// The `SFX` constants a script names when it explodes or emits. Only the names
/// matter here: the preview neither explodes nor emits, so the values are the
/// engine's and are never read back.
fn sfx_table(lua: &Lua) -> mlua::Result<Table> {
    let sfx = lua.create_table()?;
    for (name, value) in [
        ("SHATTER", 1),
        ("EXPLODE", 2),
        ("FALL", 4),
        ("SMOKE", 8),
        ("FIRE", 16),
        ("NONE", 32),
        ("NO_CEG_TRAIL", 64),
        ("NO_HEATCLOUD", 128),
        ("RECURSIVE", 65536),
    ] {
        sfx.set(name, value)?;
    }
    Ok(sfx)
}

fn install_pieces(lua: &Lua, sim: &Rc<RefCell<Sim>>) -> mlua::Result<()> {
    let state = Rc::clone(sim);
    let piece = lua.create_function(move |_, names: MultiValue| {
        let sim = state.borrow();
        let mut out = Vec::with_capacity(names.len());
        for value in names {
            let Value::String(name) = value else {
                return Err(mlua::Error::RuntimeError(
                    "piece() takes piece names as strings".into(),
                ));
            };
            let name = name.to_string_lossy();
            let index = sim.pieces.iter().position(|piece| piece.name == name);
            let Some(index) = index else {
                return Err(mlua::Error::RuntimeError(format!(
                    "this unit has no piece called \"{name}\""
                )));
            };
            // Lua numbers pieces from one, as the engine's own callouts do.
            out.push(Value::Integer(index as i64 + 1));
        }
        Ok(MultiValue::from_iter(out))
    })?;
    lua.globals().set("piece", piece)?;
    Ok(())
}

/// The piece a script named, as an index into the unit's own list. One less
/// than the number `piece()` handed out.
fn piece_index(sim: &Sim, piece: i64) -> mlua::Result<usize> {
    usize::try_from(piece - 1)
        .ok()
        .filter(|index| *index < sim.pieces.len())
        .ok_or_else(|| mlua::Error::RuntimeError(format!("{piece} is not a piece of this unit")))
}

/// Read a piece and axis off the front of a motion call's arguments.
fn target(sim: &Sim, piece: i64, axis: i64) -> mlua::Result<(usize, usize)> {
    let axis = axis_index(axis).ok_or_else(|| {
        mlua::Error::RuntimeError(format!(
            "{axis} is not an axis: use x_axis, y_axis or z_axis"
        ))
    })?;
    Ok((piece_index(sim, piece)?, axis))
}

fn install_motion(lua: &Lua, sim: &Rc<RefCell<Sim>>) -> mlua::Result<()> {
    let globals = lua.globals();

    // Turn(piece, axis, destination, speed). Radians, and radians per second.
    // No speed, or a speed of zero, is the engine's `TurnNow`, which puts the
    // piece there at once and deliberately leaves any turn already running to
    // carry on from where it lands.
    let state = Rc::clone(sim);
    globals.set(
        "Turn",
        lua.create_function(
            move |_, (piece, axis, dest, speed): (i64, i64, f64, Option<f64>)| {
                let mut sim = state.borrow_mut();
                let (index, axis) = target(&sim, piece, axis)?;
                let piece = &mut sim.pieces[index];
                let dest = clamp_rad(dest);
                match speed.filter(|speed| *speed != 0.0) {
                    Some(speed) => piece.rotate[axis] = Some(Rotate::Turn { dest, speed }),
                    None => piece.rot[axis] = dest,
                }
                Ok(())
            },
        )?,
    )?;

    // Move(piece, axis, destination, speed). Elmos, and elmos per second. The
    // destination is measured from where the piece was built, which is what a
    // pose of zero means here and why the viewport adds these to the rest pose.
    let state = Rc::clone(sim);
    globals.set(
        "Move",
        lua.create_function(
            move |_, (piece, axis, dest, speed): (i64, i64, f64, Option<f64>)| {
                let mut sim = state.borrow_mut();
                let (index, axis) = target(&sim, piece, axis)?;
                let piece = &mut sim.pieces[index];
                match speed.filter(|speed| *speed != 0.0) {
                    Some(speed) => piece.translate[axis] = Some(Translate { dest, speed }),
                    None => piece.pos[axis] = dest,
                }
                Ok(())
            },
        )?,
    )?;

    // Spin(piece, axis, speed, accel). A spin replaces a turn on the same axis,
    // as it does in the engine: one animation per axis.
    let state = Rc::clone(sim);
    globals.set(
        "Spin",
        lua.create_function(
            move |_, (piece, axis, speed, accel): (i64, i64, f64, Option<f64>)| {
                let mut sim = state.borrow_mut();
                let (index, axis) = target(&sim, piece, axis)?;
                let accel = accel.unwrap_or(0.0).abs();
                let current = match sim.pieces[index].rotate[axis] {
                    Some(Rotate::Spin { speed, .. }) => speed,
                    _ => 0.0,
                };
                sim.pieces[index].rotate[axis] = Some(Rotate::Spin {
                    speed: if accel > 0.0 { current } else { speed },
                    target: speed,
                    accel,
                });
                Ok(())
            },
        )?,
    )?;

    // StopSpin(piece, axis, decel). No deceleration stops it dead.
    let state = Rc::clone(sim);
    globals.set(
        "StopSpin",
        lua.create_function(move |_, (piece, axis, decel): (i64, i64, Option<f64>)| {
            let mut sim = state.borrow_mut();
            let (index, axis) = target(&sim, piece, axis)?;
            let decel = decel.unwrap_or(0.0).abs();
            let current = match sim.pieces[index].rotate[axis] {
                Some(Rotate::Spin { speed, .. }) => speed,
                _ => 0.0,
            };
            sim.pieces[index].rotate[axis] = (decel > 0.0).then_some(Rotate::Spin {
                speed: current,
                target: 0.0,
                accel: decel,
            });
            Ok(())
        })?,
    )?;

    for (name, hide) in [("Hide", true), ("Show", false)] {
        let state = Rc::clone(sim);
        globals.set(
            name,
            lua.create_function(move |_, piece: i64| {
                let mut sim = state.borrow_mut();
                sim.visibility_used = true;
                sim.piece(piece)?.hidden = hide;
                Ok(())
            })?,
        )?;
    }

    // Explode(piece, sfx) throws debris and leaves the piece exactly as it was:
    // a script that wants the piece gone hides it itself. So the honest preview
    // of an explosion is nothing happening, said out loud.
    let state = Rc::clone(sim);
    globals.set(
        "Explode",
        lua.create_function(move |_, (piece, _sfx): (i64, Option<i64>)| {
            let mut sim = state.borrow_mut();
            piece_index(&sim, piece)?;
            sim.note("Explode throws no debris in the preview.".to_string());
            Ok(())
        })?,
    )?;

    Ok(())
}

fn install_threading(lua: &Lua, sim: &Rc<RefCell<Sim>>) -> mlua::Result<()> {
    let globals = lua.globals();

    // The scheduler starts the thread, so this only records it. `StartThread`
    // itself is Lua, because only Lua can make the coroutine.
    let state = Rc::clone(sim);
    globals.set(
        "__spawn",
        lua.create_function(move |_, (thread, args): (Thread, MultiValue)| {
            state
                .borrow_mut()
                .spawned
                .push((thread, args.into_iter().collect()));
            Ok(())
        })?,
    )?;

    // Whether there is anything to wait for. The engine asks this before
    // suspending, so a wait on an axis that is not moving costs nothing at all
    // rather than costing a frame.
    let state = Rc::clone(sim);
    globals.set(
        "__needswait",
        lua.create_function(move |_, (piece, axis, kind): (i64, i64, String)| {
            let sim = state.borrow();
            let (index, axis) = target(&sim, piece, axis)?;
            let piece = &sim.pieces[index];
            Ok(match kind.as_str() {
                "turn" => matches!(piece.rotate[axis], Some(Rotate::Turn { .. })),
                _ => piece.translate[axis].is_some(),
            })
        })?,
    )?;

    let state = Rc::clone(sim);
    globals.set(
        "Signal",
        lua.create_function(move |_, mask: i64| {
            state.borrow_mut().signalled.push(mask as u32);
            Ok(())
        })?,
    )?;

    let state = Rc::clone(sim);
    globals.set(
        "SetSignalMask",
        lua.create_function(move |_, mask: i64| {
            state.borrow_mut().mask = Some(mask as u32);
            Ok(())
        })?,
    )?;

    Ok(())
}

/// The calls a preview cannot honour but must not fail on: sound, effects and
/// the world outside the model. Each one is noted the first time it is used, so
/// the panel can say what it left out rather than pretending it did it.
fn install_stubs(lua: &Lua, sim: &Rc<RefCell<Sim>>) -> mlua::Result<()> {
    let globals = lua.globals();
    for name in [
        "EmitSfx",
        "PlaySoundFile",
        "AttachUnit",
        "DropUnit",
        "SetUnitValue",
        "ChangeHeading",
    ] {
        let state = Rc::clone(sim);
        let label = name.to_string();
        globals.set(
            name,
            lua.create_function(move |_, _: MultiValue| {
                state
                    .borrow_mut()
                    .note(format!("{label} does nothing in the preview."));
                Ok(())
            })?,
        )?;
    }
    globals.set(
        "GetUnitValue",
        lua.create_function(|_, _: MultiValue| Ok(0))?,
    )?;
    Ok(())
}

/// The Lua half of the API: the calls that suspend a thread.
///
/// These have to be Lua rather than Rust, because a Rust function cannot yield
/// across the C boundary in Lua 5.1. Each one hands the scheduler a kind and
/// its arguments, and the scheduler decides when the thread comes back.
fn bootstrap(lua: &Lua) -> mlua::Result<()> {
    lua.load(
        r#"
        function Sleep(ms) coroutine.yield("sleep", ms or 0) end
        function WaitForTurn(piece, axis)
            if __needswait(piece, axis, "turn") then coroutine.yield("turn", piece, axis) end
        end
        function WaitForMove(piece, axis)
            if __needswait(piece, axis, "move") then coroutine.yield("move", piece, axis) end
        end
        function StartThread(fn, ...) __spawn(coroutine.create(fn), ...) end
        math.randomseed(0)
        "#,
    )
    .set_name("unitscript:bootstrap")
    .exec()
}

#[cfg(test)]
#[path = "unitscript_tests.rs"]
mod tests;
