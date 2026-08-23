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
//! Where the pieces are and how they move is not here. That lives in
//! [`coilbox_unitpose`], because a compiled `.cob` animates the same model the
//! same way and the two runtimes agreeing is the whole point of a preview.
//!
//! What it is for: previewing a unit's own script in the builder's viewport.
//! It is not the engine and does not try to be. It moves pieces, hides them and
//! runs threads. Weapons, world state, terrain, damage and sound are absent, and
//! anything a script asks for that is not here is reported rather than faked.
//!
//! [`SpringLua`]: crate::SpringLua

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use mlua::{
    Function, Lua, LuaOptions, LuaSerdeExt, MultiValue, StdLib, Table, Thread, ThreadStatus, Value,
};
use serde::Serialize;

use coilbox_unitpose::{axis_index, Model, Wait, TICK_MS};
pub use coilbox_unitpose::{ScriptEvent, Timeline, FPS, MAX_FRAMES};

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

/// What one call-in that returns a piece answered.
///
/// Separate from [`Timeline`] because it is a different question. A timeline
/// says what a script did to the model. This says what a script told us about
/// it, which is a stronger thing: `QueryNanoPiece` returning `nano2` is the
/// script naming that piece's job rather than us inferring it from motion.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// Key in the script's `script` table, such as `QueryNanoPiece`.
    pub callin: String,
    /// The pieces it named, in call order and with repeats kept.
    ///
    /// Called more than once because a builder with several nozzles cycles
    /// them, so one call sees one of them. Order is kept because it is the
    /// cycle: the caller decides whether to care.
    pub pieces: Vec<String>,
    /// Why it named nothing. A script with no such call-in, one that threw, or
    /// one that answered with something that is not a piece of this unit.
    pub note: Option<String>,
}

/// Every probe of one script, plus whatever went wrong before any ran.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probes {
    /// The unit's piece names, so a caller can check they are what it expected.
    pub pieces: Vec<String>,
    pub probes: Vec<Probe>,
    /// Set when the script could not be loaded at all, in which case `probes`
    /// is empty. A script that loaded and then answered badly reports that on
    /// the probe itself instead.
    pub error: Option<String>,
}

/// Everything the Lua-facing functions read or write. Shared with them through
/// an `Rc<RefCell<_>>`, so every borrow is short and none is held across a call
/// back into Lua.
///
/// The model is the shared one. What is here beside it is the part only a Lua
/// script has: coroutines it asked to start, and the signals it raised, both of
/// which the scheduler takes up after the call that made them returns.
#[derive(Debug, Default)]
struct Sim {
    model: Model,
    /// Threads a running thread asked for. Started before the frame ends.
    spawned: Vec<(Thread, Vec<Value>)>,
    /// Signal masks the running thread raised while it was running.
    signalled: Vec<u32>,
    /// The mask the running thread set for itself, if it did.
    mask: Option<u32>,
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
    unit_def: Option<&serde_json::Value>,
    includes: &HashMap<String, String>,
) -> Timeline {
    match Run::start(script, name, pieces, unit_def, includes) {
        Ok(mut run) => run.play(events, frames.min(MAX_FRAMES)),
        Err(error) => Timeline::failed(pieces, error),
    }
}

/// How many times each probe calls its call-in.
///
/// Enough to walk a cycle of nozzles round and back. A builder with more emit
/// points than this reports the first sixteen rather than all of them, which is
/// a worse answer than the whole cycle and a much better one than one piece.
const PROBE_CALLS: usize = 16;

/// Ask a script which pieces it names, by calling the call-ins that return one.
///
/// This is not a run. Nothing is animated and no frames pass: each call-in is
/// called directly and its return value read, because these are the call-ins
/// the engine itself calls for an answer rather than for an effect.
///
/// That is also why they are safe to call this way. `QueryNanoPiece` is
/// commented out of `thread_wrap` in the unit script framework, so it may not
/// wait for anything and has to answer immediately, and the same holds for
/// `QueryWeapon` and `AimFromWeapon`. A call-in that blocks would hang here,
/// which is what the instruction budget is for.
///
/// Never returns an error. A script that will not load comes back with `error`
/// set, and one that loads but answers badly says so on the probe itself.
pub fn probe(
    script: &str,
    name: &str,
    pieces: &[String],
    callins: &[String],
    unit_def: Option<&serde_json::Value>,
    includes: &HashMap<String, String>,
) -> Probes {
    let mut run = match Run::start(script, name, pieces, unit_def, includes) {
        Ok(run) => run,
        Err(error) => {
            return Probes {
                pieces: pieces.to_vec(),
                probes: Vec::new(),
                error: Some(error),
            }
        }
    };
    Probes {
        pieces: pieces.to_vec(),
        probes: callins.iter().map(|callin| run.probe(callin)).collect(),
        error: None,
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
    fn start(
        script: &str,
        name: &str,
        pieces: &[String],
        unit_def: Option<&serde_json::Value>,
        includes: &HashMap<String, String>,
    ) -> Result<Self, String> {
        let sim = Rc::new(RefCell::new(Sim {
            model: Model::new(pieces),
            ..Sim::default()
        }));
        let budget = Rc::new(Cell::new(FRAME_INSTRUCTIONS));
        let lua = sandbox(&sim, &budget, unit_def, includes)
            .map_err(|e| format!("could not build the Lua sandbox: {e}"))?;
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

    /// Call one call-in repeatedly and collect the pieces it named.
    ///
    /// Each call gets a fresh instruction budget, so a script doing real work
    /// per call is not cut off part way by whatever the call before it spent.
    ///
    /// A call that throws stops the probe rather than being retried: the first
    /// failure says why, and fifteen more copies of it say nothing.
    fn probe(&mut self, callin: &str) -> Probe {
        let Ok(Some(function)) = self.script.get::<Option<Function>>(callin) else {
            return Probe {
                callin: callin.to_string(),
                pieces: Vec::new(),
                note: Some(format!("This script has no {callin} call-in.")),
            };
        };

        let mut pieces = Vec::new();
        let mut note = None;
        for _ in 0..PROBE_CALLS {
            self.budget.set(FRAME_INSTRUCTIONS);
            match function.call::<Option<i64>>(()) {
                Ok(Some(index)) => {
                    match piece_index(&self.sim.borrow(), index) {
                        Ok(at) => pieces.push(self.sim.borrow().model.pieces[at].name.clone()),
                        // A number that is not a piece of this unit. Worth
                        // saying rather than dropping: it is usually a script
                        // written against a model this one is not.
                        Err(error) => {
                            note = Some(error.to_string());
                            break;
                        }
                    }
                }
                Ok(None) => {
                    note = Some(format!("{callin} answered with nothing."));
                    break;
                }
                Err(error) => {
                    note = Some(describe(&error));
                    break;
                }
            }
        }

        Probe {
            callin: callin.to_string(),
            pieces,
            note,
        }
    }

    fn play(&mut self, events: &[ScriptEvent], frames: u32) -> Timeline {
        let names = self
            .sim
            .borrow()
            .model
            .pieces
            .iter()
            .map(|piece| piece.name.clone())
            .collect();
        let mut timeline = Timeline::new(names, frames as usize);

        for frame in 0..frames {
            self.frame = frame;
            if let Err(error) = self.step(events) {
                timeline.error = Some(error);
                break;
            }
            self.sim.borrow().model.sample(&mut timeline);
        }

        self.sim.borrow().model.finish(&mut timeline);
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
        self.sim.borrow_mut().model.tick();
        self.wake_finished();
        self.fire_due(events)?;
        self.run_threads()
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
            if !sim.model.animating(piece, axis, kind) {
                runner.state = State::Ready;
            }
        }
    }

    fn fire_due(&mut self, events: &[ScriptEvent]) -> Result<(), String> {
        let frame = self.frame;
        for event in events.iter().filter(|event| event.frame == frame) {
            let function: Option<Function> = self.script.get(event.callin.as_str()).ok().flatten();
            let Some(function) = function else {
                if !event.ambient {
                    self.sim
                        .borrow_mut()
                        .model
                        .note(format!("This script has no {} call-in.", event.callin));
                }
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
                    .filter(|piece| *piece < self.sim.borrow().model.pieces.len())
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
}

impl Runner {
    fn is_dead(&self) -> bool {
        matches!(self.state, State::Dead)
    }
}

/// A number a yield carried, whichever of Lua's two number shapes it arrived in.
fn number(value: Option<Value>) -> f64 {
    match value {
        Some(Value::Integer(number)) => number as f64,
        Some(Value::Number(number)) => number,
        _ => 0.0,
    }
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
fn sandbox(
    sim: &Rc<RefCell<Sim>>,
    budget: &Rc<Cell<i64>>,
    unit_def: Option<&serde_json::Value>,
    includes: &HashMap<String, String>,
) -> mlua::Result<Lua> {
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
    install_include(&lua, sim, includes)?;
    bootstrap(&lua)?;
    install_unit_script_table(&lua)?;
    install_unit_def(&lua, sim, unit_def)?;
    Ok(lua)
}

/// The same API again, under the table a script may reach it through.
///
/// The unit script framework puts every call-out in the script's own
/// environment and also in a `UnitScript` table, and a game picks whichever it
/// prefers. Beyond All Reason's scripts use both in the same file:
/// `coralab.lua` calls `Turn` bare and `UnitScript.Turn` a few lines later.
/// Without the table those scripts fail on the first line that uses it.
///
/// Built from the globals rather than beside them, so the two can never come to
/// mean different things.
fn install_unit_script_table(lua: &Lua) -> mlua::Result<()> {
    let globals = lua.globals();
    let table = lua.create_table()?;
    for name in [
        "Turn",
        "Move",
        "Spin",
        "StopSpin",
        "Show",
        "Hide",
        "Explode",
        "EmitSfx",
        "Sleep",
        "WaitForTurn",
        "WaitForMove",
        "StartThread",
        "Signal",
        "SetSignalMask",
        "SetUnitValue",
        "GetUnitValue",
        "PlaySoundFile",
        "AttachUnit",
        "DropUnit",
    ] {
        let held: Value = globals.get(name)?;
        table.set(name, held)?;
    }
    globals.set("UnitScript", table)
}

/// The unit's own definition, under the two names a script reads it by.
///
/// A unit script is allowed to read its own definition, and BAR's do:
/// `coralab.lua` decides which of two animations it has from
/// `UnitDefs[unitDefID].customParams.litelab`. Without them the script does not
/// lose a branch, it throws on the line and the unit does not animate at all,
/// which is why an empty `UnitDefs` would not do either: indexing the missing
/// entry throws on the same line.
///
/// Keys resolve without regard to case. The definition coilbox reads comes back
/// through a game's own def scripts, which lowercase every key on the way out,
/// while the engine builds its `UnitDefs` from its own structures and keeps the
/// case. So a script asking for `customParams` is asking for the thing stored
/// as `customparams`, and matching loosely is the closest true answer available
/// rather than a guess.
///
/// A field the definition does not declare reads as nothing, which is what the
/// engine answers. Standing in an empty table instead would make every absent
/// field read as present and flip the branch it was being asked about, which is
/// the whole thing this is meant to avoid. The one exception is `customParams`,
/// because every definition the engine builds carries one whether the game
/// declared it or not.
///
/// A unit with no definition behind it, one built out of parts or opened from a
/// file, gets an empty one and a note the first time the script reads anything
/// off it. That is the honest shape: the script runs, and whoever is watching
/// is told that a branch may have gone the way it did for want of an answer.
fn install_unit_def(
    lua: &Lua,
    sim: &Rc<RefCell<Sim>>,
    unit_def: Option<&serde_json::Value>,
) -> mlua::Result<()> {
    let globals = lua.globals();
    let def: Value = match unit_def {
        Some(json) => lua.to_value(json)?,
        None => Value::Table(lua.create_table()?),
    };

    // Said once, from Lua, so it fires when the script actually reads the
    // definition rather than on every unit that has none.
    let state = Rc::clone(sim);
    globals.set(
        "__nodef",
        lua.create_function(move |_, key: String| {
            state.borrow_mut().model.note(format!(
                "This script reads {key} off its own unit definition, which the preview does not have for this unit, so it read an empty one."
            ));
            Ok(())
        })?,
    )?;
    globals.set("__rawdef", def)?;
    globals.set("__hasdef", unit_def.is_some())?;

    lua.load(
        r#"
        local function insensitive(value, missing)
          if type(value) ~= 'table' then return value end
          local out, lower = {}, {}
          for key, held in pairs(value) do
            local wrapped = insensitive(held, missing)
            out[key] = wrapped
            if type(key) == 'string' then lower[string.lower(key)] = wrapped end
          end
          return setmetatable(out, {
            __index = function(_, key)
              if type(key) ~= 'string' then return nil end
              local hit = lower[string.lower(key)]
              -- Nothing, the way the engine answers for a field a definition
              -- does not declare. Standing in an empty table instead would make
              -- every absent key read as present, which is the branch-flipping
              -- this is meant to avoid.
              if hit == nil and missing then missing(key) end
              return hit
            end,
          })
        end
        local missing = (not __hasdef) and __nodef or nil
        -- Every UnitDef the engine builds carries a customParams table, empty
        -- or not, so a script reading one on a unit that declares none is
        -- reading an empty table rather than failing.
        if type(__rawdef) == 'table' then
          local has = false
          for key in pairs(__rawdef) do
            if type(key) == 'string' and string.lower(key) == 'customparams' then has = true end
          end
          if not has then __rawdef.customParams = {} end
        end
        unitDefID = 1
        UnitDefs = { insensitive(__rawdef, missing) }
        __rawdef, __hasdef, __nodef = nil, nil, nil
        "#,
    )
    .set_name("unitscript:unitdef")
    .exec()
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
            let index = sim.model.pieces.iter().position(|piece| piece.name == name);
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
        .filter(|index| *index < sim.model.pieces.len())
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
                sim.model.turn(index, axis, dest, speed.unwrap_or(0.0));
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
                sim.model.r#move(index, axis, dest, speed.unwrap_or(0.0));
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
                sim.model.spin(index, axis, speed, accel.unwrap_or(0.0));
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
            sim.model.stop_spin(index, axis, decel.unwrap_or(0.0));
            Ok(())
        })?,
    )?;

    for (name, hide) in [("Hide", true), ("Show", false)] {
        let state = Rc::clone(sim);
        globals.set(
            name,
            lua.create_function(move |_, piece: i64| {
                let mut sim = state.borrow_mut();
                let index = piece_index(&sim, piece)?;
                sim.model.set_hidden(index, hide);
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
            sim.model
                .note("Explode throws no debris in the preview.".to_string());
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
            let kind = if kind == "turn" {
                Wait::Turn
            } else {
                Wait::Move
            };
            Ok(sim.model.animating(index, axis, kind))
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
                    .model
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

/// `include`, over the library files the caller read out of the unit's game.
///
/// A game may keep half its animation in a shared library and have every unit
/// pull it in, which is Beyond All Reason's house style: `coralab.lua` opens
/// with `include("include/util.lua")` and then starts a thread on a function
/// that lives in it. Without the file the function is nil and the script stops
/// on the line that calls it.
///
/// The preview has no archive to read, so the files come in with the script,
/// read at import by whoever had the game open. `sources` is keyed by the name
/// the script asks for, folded the way the engine's VFS folds a path, because
/// that name is all a script ever says about a file.
///
/// What the framework does, from `MemoizedInclude` in
/// `LuaGadgets/Gadgets/unit_script.lua`, and what this does with it:
///
/// - the chunk runs in the unit's own environment, which here is the sandbox's
///   globals, so a library defining a global defines it for the script.
/// - what the chunk returns is what `include` returns, because a game
///   assigning `common = include("...")` needs the value rather than the
///   globals.
/// - a file that will not load is logged and answers nothing. That is a note
///   here, for the same reason the sound calls are notes: a preview that
///   stopped would say less than one that carries on and says what it skipped.
/// - a file that loads and then throws takes the caller down with it, which is
///   plain Lua and is what the framework does too.
fn install_include(
    lua: &Lua,
    sim: &Rc<RefCell<Sim>>,
    includes: &HashMap<String, String>,
) -> mlua::Result<()> {
    let sources: HashMap<String, String> = includes
        .iter()
        .map(|(name, text)| (fold_include(name), text.clone()))
        .collect();
    let state = Rc::clone(sim);
    lua.globals().set(
        "include",
        lua.create_function(move |lua, name: String| {
            let Some(source) = sources.get(&fold_include(&name)) else {
                state.borrow_mut().model.note(format!(
                    "include(\"{name}\") read nothing: the preview does not have that file, so whatever it defines is missing."
                ));
                return Ok(MultiValue::new());
            };
            match lua.load(source.as_str()).set_name(&name).into_function() {
                Ok(chunk) => chunk.call::<MultiValue>(()),
                Err(error) => {
                    state.borrow_mut().model.note(format!(
                        "include(\"{name}\") could not be loaded: {}",
                        describe(&error)
                    ));
                    Ok(MultiValue::new())
                }
            }
        })?,
    )
}

/// One name for a file, whatever the script spelled it as.
///
/// Case and separators both, because an archive's paths are folded that way and
/// a script written on Windows names a file with backslashes.
fn fold_include(name: &str) -> String {
    name.trim().replace('\\', "/").to_lowercase()
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
