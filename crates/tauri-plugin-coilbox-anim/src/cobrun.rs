//! Run a compiled `.cob` animation script and report the pose its pieces are
//! in on each frame.
//!
//! A game that compiled its animation ships bytecode, and coilbox could name
//! the file and disassemble it but not play it, so a walker imported out of an
//! older game stood still. Decompiling it back to source is the obvious route
//! and does not work: a disassembly is a stack-machine listing, nothing in it
//! distinguishes a signed number from a piece index from a jump target, and
//! recovering source would mean control-flow reconstruction and operand typing.
//! Running the bytecode is both easier and exact.
//!
//! COB is a small stack machine. Each script is a run of 32-bit words, some of
//! them opcodes and some of them operands, executed by threads that sleep and
//! wait on the animations they start. That is the same shape as the Lua unit
//! script runtime, so this drives the same model out of [`coilbox_unitpose`]
//! and hands back the same [`Timeline`]. Nothing downstream knows the
//! difference.
//!
//! `CCobThread::Tick` in the engine is the reference this is ported from, the
//! same way the BOS compiler beside it was ported from the Python. Where the
//! two could differ they do not: the fixed-point conversions, the three sign
//! flips `CobInstance.h` labels COBWTF, and the sleep clock all follow it.
//!
//! It is read-only by construction. It executes words held in memory and never
//! opens a file for anything.
//!
//! What is absent is the world. A script asking about its own health, the
//! ground under it or the wind gets zero and a note saying so, because a
//! preview has no unit and no map, and a number that looks like an answer is
//! worse than being told there is none.

use std::collections::HashMap;

use coilbox_unitpose::{unitvalue, Model, ScriptEvent, Timeline, Wait, MAX_FRAMES, TICK_MS};

use crate::cob;
use crate::opcodes::{mnemonic, opcode};

/// COB's fixed-point scale: 65536ths of an elmo for a distance, and 65536ths
/// of a full circle for an angle.
const COBSCALE: f64 = 65536.0;

/// One COB angular unit in radians. The engine's `TAANG2RAD`.
const TAANG2RAD: f64 = std::f64::consts::PI / 32768.0;

/// Radians to COB angular units, for the two trigonometry call-outs that answer
/// in them.
const RAD2TAANG: f64 = 32768.0 / std::f64::consts::PI;

/// Instructions one frame may execute before the run is abandoned.
///
/// Refilled each frame, so this is a per-frame budget: a thread that loops
/// without sleeping is caught on the frame it does it, and a long run of well
/// behaved frames is never punished for its length.
const FRAME_INSTRUCTIONS: i64 = 500_000;

/// Most threads that may exist at once. A script starting a thread per frame is
/// a bug, and without a ceiling it is a hang.
const MAX_THREADS: usize = 256;

/// The `GET`, `GET_UNIT_VALUE` and `SET` ids that stand for a Lua call's return
/// slots rather than for anything about the unit.
const LUA0: i32 = 110;
const LUA9: i32 = 119;

/// Two-argument `atan`, answering in COB angular units.
const ATAN: i32 = 14;
/// Two-argument `hypot`, answering in the same units it was given.
const HYPOT: i32 = 15;

/// Run the compiled script in `bytes` for `frames` frames, firing `events` as
/// they come due.
///
/// `pieces` is the model's piece names. A `.cob` numbers its own pieces its own
/// way and carries their names, so the two are tied together by name: a script
/// naming a piece this model does not have is a note rather than a failure,
/// because the rest of the unit still animates and the mismatch usually means
/// the script was written against a variant of the model.
///
/// Never returns an error. A file that will not decode, a thread that loops
/// without sleeping and a word that is not an opcode all come back as a
/// [`Timeline`] with `error` set and whatever frames it managed first.
pub fn run(bytes: &[u8], pieces: &[String], events: &[ScriptEvent], frames: u32) -> Timeline {
    match Run::start(bytes, pieces) {
        Ok(mut run) => run.play(events, frames.min(MAX_FRAMES)),
        Err(error) => Timeline::failed(pieces, error),
    }
}

/// The decoded file, with everything the interpreter needs looked up once.
struct Program {
    /// Script names, in the file's own order.
    names: Vec<String>,
    /// Every script's code end to end. A jump target is an offset into this.
    code: Vec<u32>,
    /// Where each script starts in `code`.
    offsets: Vec<usize>,
    /// How long each script is, because a call to an empty one does nothing.
    lengths: Vec<usize>,
    /// This file's piece index to the model's, matched by name. `None` for a
    /// piece the model does not have.
    pieces: Vec<Option<usize>>,
    /// This file's piece names, so a note can say which one is missing.
    piece_names: Vec<String>,
}

impl Program {
    fn read(bytes: &[u8], model_pieces: &[String]) -> Result<Self, String> {
        let decoded = cob::decode(bytes)?;
        let lookup: HashMap<String, usize> = model_pieces
            .iter()
            .enumerate()
            .map(|(index, name)| (name.to_lowercase(), index))
            .collect();
        let pieces = decoded
            .pieces
            .iter()
            .map(|name| lookup.get(&name.to_lowercase()).copied())
            .collect();
        let offsets = decoded.offsets.clone();
        let lengths = (0..offsets.len())
            .map(|i| {
                offsets
                    .get(i + 1)
                    .copied()
                    .unwrap_or(decoded.code.len())
                    .saturating_sub(offsets[i])
            })
            .collect();
        Ok(Self {
            names: decoded
                .scripts
                .iter()
                .map(|(name, _)| name.clone())
                .collect(),
            code: decoded.code,
            offsets,
            lengths,
            pieces,
            piece_names: decoded.pieces,
        })
    }

    /// The script a call-in name means.
    ///
    /// Exact first, then the older name for the same thing: a `.cob` from
    /// before the rename calls its first weapon Primary, and the scenarios the
    /// builder offers are written the way Recoil names them now.
    fn script(&self, callin: &str) -> Option<usize> {
        let find = |want: &str| {
            self.names
                .iter()
                .position(|name| name.eq_ignore_ascii_case(want))
        };
        find(callin).or_else(|| alias(callin).and_then(|older| find(&older)))
    }
}

/// The name an older `.cob` uses for a call-in Recoil now numbers.
///
/// `CobScriptNames.cpp` keeps both spellings in its map for exactly this
/// reason. Only the first three weapons ever had words rather than numbers.
fn alias(callin: &str) -> Option<String> {
    const ORDINALS: [&str; 3] = ["Primary", "Secondary", "Tertiary"];
    for (index, ordinal) in ORDINALS.iter().enumerate() {
        let numbered = format!("{}", index + 1);
        for stem in ["Query", "Aim", "AimFrom", "Fire"] {
            if callin.eq_ignore_ascii_case(&format!("{stem}Weapon{numbered}")) {
                return Some(format!("{stem}{ordinal}"));
            }
        }
    }
    None
}

/// Whether a call-in is handed angles rather than plain numbers.
///
/// The scenarios the builder offers are written in radians, because that is
/// what the Lua unit script framework takes. A `.cob` counts angles in 65536ths
/// of a circle, so the same instruction has to arrive here as a different
/// number. Only aiming and building are handed angles at all.
fn takes_angles(callin: &str) -> bool {
    let callin = callin.to_ascii_lowercase();
    callin.starts_with("aim") || callin == "startbuilding"
}

/// One frame of a script's call stack.
struct Call {
    /// Where to carry on in the caller, or `None` for the thread's first frame,
    /// which is where returning ends the thread.
    ret: Option<usize>,
    /// How much of the data stack belongs to callers, so a return can drop
    /// everything this frame put on it.
    stack_top: usize,
}

enum State {
    /// Run as soon as the scheduler gets to it.
    Ready,
    /// Run once the clock passes this, in milliseconds.
    Sleeping(i64),
    /// Run once this piece's animation on this axis finishes.
    Waiting {
        piece: Option<usize>,
        axis: usize,
        kind: Wait,
    },
    Dead,
}

struct Thread {
    pc: usize,
    data: Vec<i32>,
    calls: Vec<Call>,
    /// How many of this frame's arguments are still on the stack rather than
    /// having been claimed by a `CREATE_LOCAL_VAR`.
    params: i32,
    /// What a `SIGNAL` kills by.
    mask: u32,
    state: State,
    /// The ten slots a Lua call would answer in. Nothing answers in them here,
    /// which is what the first one being zero means.
    lua: [i32; 10],
    /// The call-in this thread came from, so an error can name it.
    origin: String,
}

impl Thread {
    fn new(function: usize, pc: usize, mask: u32, origin: String) -> Self {
        let _ = function;
        Self {
            pc,
            data: Vec::new(),
            calls: vec![Call {
                ret: None,
                stack_top: 0,
            }],
            params: 0,
            mask,
            state: State::Ready,
            lua: [0; 10],
            origin,
        }
    }

    fn frame(&self) -> usize {
        self.calls.last().map_or(0, |call| call.stack_top)
    }
}

struct Run {
    program: Program,
    model: Model,
    statics: Vec<i32>,
    threads: Vec<Thread>,
    /// Threads a running thread started. The engine queues these and adds them
    /// after the tick that made them, so a started script never runs inside the
    /// call that started it.
    queued: Vec<Thread>,
    frame: u32,
    /// The clock a `SLEEP` is measured against, in milliseconds.
    time: i64,
    budget: i64,
    /// State for the deterministic `RAND`. A preview that shuffled itself every
    /// time it was asked would be impossible to look at.
    rng: u64,
    /// Values the script has set on its unit, so it can read back what it
    /// stored. Scripts keep real state this way: whether the yard is open,
    /// whether the unit is armoured, whether it is switched on.
    set_values: HashMap<i32, i32>,
}

impl Run {
    fn start(bytes: &[u8], pieces: &[String]) -> Result<Self, String> {
        let program = Program::read(bytes, pieces)?;
        let mut model = Model::new(pieces);
        for (index, name) in program.piece_names.iter().enumerate() {
            if program.pieces[index].is_none() {
                model.note(format!(
                    "This script animates a piece called {name}, which this unit does not have."
                ));
            }
        }
        Ok(Self {
            program,
            model,
            statics: vec![0; 256],
            threads: Vec::new(),
            queued: Vec::new(),
            frame: 0,
            time: 0,
            budget: FRAME_INSTRUCTIONS,
            rng: 0x2545_F491_4F6C_DD1D,
            set_values: HashMap::new(),
        })
    }

    fn play(&mut self, events: &[ScriptEvent], frames: u32) -> Timeline {
        let names = self
            .model
            .pieces
            .iter()
            .map(|piece| piece.name.clone())
            .collect();
        let mut timeline = Timeline::new(names, frames as usize);

        for frame in 0..frames {
            self.frame = frame;
            self.time = i64::from(frame) * TICK_MS as i64;
            if let Err(error) = self.step(events) {
                timeline.error = Some(error);
                break;
            }
            self.model.sample(&mut timeline);
        }

        self.model.finish(&mut timeline);
        timeline
    }

    /// One frame: tick the animations, wake what they finished, fire what is
    /// due, then run every thread that can run.
    ///
    /// Animations tick before threads run, so a turn issued this frame first
    /// moves on the next one. That is the engine's order, and it is what makes
    /// a sleep cost time rather than nothing.
    fn step(&mut self, events: &[ScriptEvent]) -> Result<(), String> {
        self.budget = FRAME_INSTRUCTIONS;
        self.model.tick();
        self.wake_finished();
        self.fire_due(events)?;
        self.run_threads()
    }

    /// Anything waiting on an animation that is no longer running is ready.
    ///
    /// A wait on an axis with nothing on it is satisfied at once, which is what
    /// the engine does and what stops a wait on a turn that already finished
    /// hanging the thread forever.
    fn wake_finished(&mut self) {
        for thread in &mut self.threads {
            let State::Waiting { piece, axis, kind } = thread.state else {
                continue;
            };
            let still_going = piece.is_some_and(|piece| self.model.animating(piece, axis, kind));
            if !still_going {
                thread.state = State::Ready;
            }
        }
    }

    fn fire_due(&mut self, events: &[ScriptEvent]) -> Result<(), String> {
        let frame = self.frame;
        for event in events.iter().filter(|event| event.frame == frame) {
            let Some(function) = self.program.script(&event.callin) else {
                if !event.ambient {
                    self.model
                        .note(format!("This script has no {} call-in.", event.callin));
                }
                continue;
            };
            let mut thread = Thread::new(
                function,
                self.program.offsets[function],
                0,
                event.callin.clone(),
            );
            // Arguments arrive on the stack, the way a call leaves them, and
            // `CREATE_LOCAL_VAR` claims them one at a time.
            let scale = if takes_angles(&event.callin) {
                RAD2TAANG
            } else {
                1.0
            };
            thread.data = event.args.iter().map(|arg| (arg * scale) as i32).collect();
            thread.params = thread.data.len() as i32;
            self.add(thread)?;
        }
        Ok(())
    }

    fn add(&mut self, thread: Thread) -> Result<(), String> {
        if self.alive() >= MAX_THREADS {
            return Err(format!(
                "this script has more than {MAX_THREADS} threads running at once"
            ));
        }
        self.threads.push(thread);
        Ok(())
    }

    fn alive(&self) -> usize {
        self.threads
            .iter()
            .filter(|thread| !matches!(thread.state, State::Dead))
            .count()
    }

    /// Run every thread that can run, then anything they started, until nothing
    /// is left that can run this frame.
    fn run_threads(&mut self) -> Result<(), String> {
        // A thread that comes back ready every time, on a wait already
        // satisfied, would spin here forever without a ceiling.
        for _ in 0..MAX_THREADS * 4 {
            let Some(index) = self.next_ready() else {
                self.threads.retain(|t| !matches!(t.state, State::Dead));
                return Ok(());
            };
            self.tick_thread(index)?;
            for thread in std::mem::take(&mut self.queued) {
                self.add(thread)?;
            }
        }
        Err("this frame's threads never settled: one is waiting on itself".to_string())
    }

    fn next_ready(&self) -> Option<usize> {
        self.threads.iter().position(|thread| match thread.state {
            State::Ready => true,
            // The engine wakes a sleeper once the clock has passed its wake
            // time rather than reached it, so `Sleep(33)` costs two frames.
            State::Sleeping(wake) => wake < self.time,
            _ => false,
        })
    }

    // The stack and program counter, reached by index so a motion opcode can
    // touch the model in the same breath.

    fn push(&mut self, thread: usize, value: i32) {
        self.threads[thread].data.push(value);
    }

    fn pop(&mut self, thread: usize) -> i32 {
        self.threads[thread].data.pop().unwrap_or(0)
    }

    /// The next word, which is an operand rather than an opcode.
    fn word(&mut self, thread: usize) -> Result<i32, String> {
        let pc = self.threads[thread].pc;
        let word = self
            .program
            .code
            .get(pc)
            .copied()
            .ok_or_else(|| self.ran_off_the_end(thread))?;
        self.threads[thread].pc += 1;
        Ok(word as i32)
    }

    fn ran_off_the_end(&self, thread: usize) -> String {
        format!(
            "{}: ran past the end of the script",
            self.threads[thread].origin
        )
    }

    /// Run one thread until it sleeps, waits or dies.
    fn tick_thread(&mut self, index: usize) -> Result<(), String> {
        self.threads[index].state = State::Ready;
        while matches!(self.threads[index].state, State::Ready) {
            self.budget -= 1;
            if self.budget < 0 {
                return Err(format!(
                    "{}: this frame ran too long, so a thread is looping without a sleep",
                    self.threads[index].origin
                ));
            }
            let word = self.word(index)? as u32;
            self.execute(index, word)?;
        }
        Ok(())
    }
}

/// The model piece a `.cob` piece index means, and whether the model has it.
fn model_piece(program: &Program, piece: i32) -> Option<usize> {
    usize::try_from(piece)
        .ok()
        .and_then(|piece| program.pieces.get(piece).copied())
        .flatten()
}

/// The axis index a COB operand means. COB counts from zero, unlike Lua.
fn axis_of(axis: i32) -> Option<usize> {
    (0..3).contains(&axis).then_some(axis as usize)
}

impl Run {
    /// One instruction. A port of the `switch` in `CCobThread::Tick`.
    fn execute(&mut self, i: usize, word: u32) -> Result<(), String> {
        let op = |name: &str| opcode(name).expect("mnemonic is in the opcode table");

        match word {
            // Stack.
            w if w == op("PUSH_CONSTANT") => {
                let value = self.word(i)?;
                self.push(i, value);
            }
            w if w == op("PUSH_LOCAL_VAR") => {
                let slot = self.word(i)? as usize;
                let at = self.threads[i].frame() + slot;
                let value = self.threads[i].data.get(at).copied().unwrap_or(0);
                self.push(i, value);
            }
            w if w == op("POP_LOCAL_VAR") => {
                let slot = self.word(i)? as usize;
                let value = self.pop(i);
                let at = self.threads[i].frame() + slot;
                if at < self.threads[i].data.len() {
                    self.threads[i].data[at] = value;
                }
            }
            w if w == op("PUSH_STATIC") => {
                let slot = self.word(i)? as usize;
                let value = self.statics.get(slot).copied().unwrap_or(0);
                self.push(i, value);
            }
            w if w == op("POP_STATIC") => {
                let slot = self.word(i)? as usize;
                let value = self.pop(i);
                if let Some(held) = self.statics.get_mut(slot) {
                    *held = value;
                }
            }
            w if w == op("POP_STACK") => {
                self.pop(i);
            }
            // A local var either claims an argument already on the stack or
            // makes itself a fresh zero.
            w if w == op("CREATE_LOCAL_VAR") => {
                if self.threads[i].params == 0 {
                    self.push(i, 0);
                } else {
                    self.threads[i].params -= 1;
                }
            }

            // Arithmetic. Both operands are popped, the second one being the
            // left hand side, so `SUB` and `DIV` are not the other way round.
            w if w == op("ADD") => self.binary(i, |a, b| a.wrapping_add(b)),
            w if w == op("SUB") => self.binary(i, |a, b| a.wrapping_sub(b)),
            w if w == op("MUL") => self.binary(i, |a, b| a.wrapping_mul(b)),
            w if w == op("DIV") => {
                let (a, b) = self.operands(i);
                if b == 0 {
                    // The engine's own answer: a thousand, and carry on.
                    self.model
                        .note("This script divides by zero somewhere.".to_string());
                    self.push(i, 1000);
                } else {
                    self.push(i, a.wrapping_div(b));
                }
            }
            w if w == op("MOD") => {
                let (a, b) = self.operands(i);
                if b == 0 {
                    self.model
                        .note("This script divides by zero somewhere.".to_string());
                    self.push(i, 0);
                } else {
                    self.push(i, a.wrapping_rem(b));
                }
            }
            w if w == op("BITWISE_AND") => self.binary(i, |a, b| a & b),
            w if w == op("BITWISE_OR") => self.binary(i, |a, b| a | b),
            w if w == op("BITWISE_XOR") => self.binary(i, |a, b| a ^ b),
            w if w == op("BITWISE_NOT") => {
                let value = self.pop(i);
                self.push(i, !value);
            }

            // Comparison. `SET_EQUAL` and `SET_NOT_EQUAL` do not care about the
            // order, so the engine pops them the other way and it makes no
            // difference.
            w if w == op("SET_LESS") => self.binary(i, |a, b| i32::from(a < b)),
            w if w == op("SET_LESS_OR_EQUAL") => self.binary(i, |a, b| i32::from(a <= b)),
            w if w == op("SET_GREATER") => self.binary(i, |a, b| i32::from(a > b)),
            w if w == op("SET_GREATER_OR_EQUAL") => self.binary(i, |a, b| i32::from(a >= b)),
            w if w == op("SET_EQUAL") => self.binary(i, |a, b| i32::from(a == b)),
            w if w == op("SET_NOT_EQUAL") => self.binary(i, |a, b| i32::from(a != b)),
            w if w == op("LOGICAL_AND") => self.binary(i, |a, b| i32::from(a != 0 && b != 0)),
            w if w == op("LOGICAL_OR") => self.binary(i, |a, b| i32::from(a != 0 || b != 0)),
            w if w == op("LOGICAL_XOR") => self.binary(i, |a, b| i32::from((a != 0) ^ (b != 0))),
            w if w == op("LOGICAL_NOT") => {
                let value = self.pop(i);
                self.push(i, i32::from(value == 0));
            }

            w if w == op("RAND") => {
                let (low, high) = self.operands(i);
                let span = high.saturating_sub(low).saturating_add(1).max(1);
                let value = low.wrapping_add((self.next_random() % span as u64) as i32);
                self.push(i, value);
            }

            // Motion. Every one of these converts out of COB's fixed point and
            // applies the sign flips `CobInstance.h` labels COBWTF.
            w if w == op("MOVE") => {
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                let dest = self.pop(i);
                let speed = self.pop(i);
                self.do_move(i, piece, axis, dest, speed);
            }
            w if w == op("MOVE_NOW") => {
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                let dest = self.pop(i);
                self.do_move(i, piece, axis, dest, 0);
            }
            w if w == op("TURN") => {
                let dest = self.pop(i);
                let speed = self.pop(i);
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                self.do_turn(i, piece, axis, dest, speed);
            }
            w if w == op("TURN_NOW") => {
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                let dest = self.pop(i);
                self.do_turn(i, piece, axis, dest, 0);
            }
            w if w == op("SPIN") => {
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                let speed = self.pop(i);
                let accel = self.pop(i);
                if let (Some(piece), Some(axis)) =
                    (model_piece(&self.program, piece), axis_of(axis))
                {
                    // A spin about z turns the other way, which is the flip a
                    // turn about z gets on its destination instead.
                    let speed = if axis == 2 { -speed } else { speed };
                    self.model.spin(
                        piece,
                        axis,
                        f64::from(speed) * TAANG2RAD,
                        f64::from(accel) * TAANG2RAD,
                    );
                }
            }
            w if w == op("STOP_SPIN") => {
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                let decel = self.pop(i);
                if let (Some(piece), Some(axis)) =
                    (model_piece(&self.program, piece), axis_of(axis))
                {
                    self.model
                        .stop_spin(piece, axis, f64::from(decel) * TAANG2RAD);
                }
            }
            w if w == op("SHOW") || w == op("HIDE") => {
                let hide = word == op("HIDE");
                let piece = self.word(i)?;
                if let Some(piece) = model_piece(&self.program, piece) {
                    self.model.set_hidden(piece, hide);
                }
            }
            // Scaling arrived in Recoil and no `.cob` in the wild uses it, but
            // the opcodes exist and stepping over them is better than dying.
            w if w == op("SCALE") => {
                self.word(i)?;
                self.pop(i);
                self.pop(i);
                self.model
                    .note("Scaling a piece does nothing in the preview.".to_string());
            }
            w if w == op("SCALE_NOW") => {
                self.word(i)?;
                self.pop(i);
                self.model
                    .note("Scaling a piece does nothing in the preview.".to_string());
            }

            // Waiting.
            w if w == op("SLEEP") => {
                let ms = self.pop(i);
                self.threads[i].state = State::Sleeping(self.time + i64::from(ms));
            }
            w if w == op("WAIT_FOR_TURN") || w == op("WAIT_FOR_MOVE") => {
                let kind = if word == op("WAIT_FOR_TURN") {
                    Wait::Turn
                } else {
                    Wait::Move
                };
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                let piece = model_piece(&self.program, piece);
                let Some(axis) = axis_of(axis) else {
                    return Ok(());
                };
                // Nothing to wait for costs nothing at all rather than a frame.
                if piece.is_some_and(|piece| self.model.animating(piece, axis, kind)) {
                    self.threads[i].state = State::Waiting { piece, axis, kind };
                }
            }
            w if w == op("WAIT_FOR_SCALE") => {
                self.word(i)?;
            }

            // Flow control.
            w if w == op("JUMP") => {
                self.threads[i].pc = self.word(i)? as usize;
            }
            w if w == op("JUMP_NOT_EQUAL") => {
                let target = self.word(i)? as usize;
                if self.pop(i) == 0 {
                    self.threads[i].pc = target;
                }
            }
            w if w == op("RETURN") => {
                self.pop(i);
                let call = self.threads[i].calls.pop();
                match call {
                    // The frame that is returning says how much of the stack to
                    // drop, not the one being returned to. Reading it off the
                    // caller instead takes the caller's own locals with it, and
                    // a unit whose walk loop calls out to a stand script then
                    // stands there doing nothing.
                    Some(Call {
                        ret: Some(ret),
                        stack_top,
                    }) => {
                        self.threads[i].pc = ret;
                        self.threads[i].data.truncate(stack_top);
                    }
                    _ => self.threads[i].state = State::Dead,
                }
            }
            w if w == op("CALL_SCRIPT") || w == op("REAL_CALL") => {
                let function = self.word(i)? as usize;
                let args = self.word(i)? as usize;
                // A `.cob` names a Lua call-out with a `lua_` prefix, which is
                // the engine's own test for one. Nothing here answers it.
                if self.is_lua_call(function) {
                    self.lua_call(i, args);
                    return Ok(());
                }
                self.call(i, function, args);
            }
            w if w == op("LUA_CALL") => {
                let _ = self.word(i)?;
                let args = self.word(i)? as usize;
                self.lua_call(i, args);
            }
            w if w == op("START_SCRIPT") => {
                let function = self.word(i)? as usize;
                let args = self.word(i)? as usize;
                self.start_thread(i, function, args);
            }
            w if w == op("SIGNAL") => {
                let signal = self.pop(i) as u32;
                self.signal(signal);
            }
            w if w == op("SET_SIGNAL_MASK") => {
                self.threads[i].mask = self.pop(i) as u32;
            }

            // Asking about a world the preview does not have.
            w if w == op("GET_UNIT_VALUE") => {
                let id = self.pop(i);
                let value = self.unit_value(i, id, 0, 0);
                self.push(i, value);
            }
            w if w == op("GET") => {
                let p4 = self.pop(i);
                let p3 = self.pop(i);
                let p2 = self.pop(i);
                let p1 = self.pop(i);
                let id = self.pop(i);
                let _ = (p3, p4);
                let value = self.unit_value(i, id, p1, p2);
                self.push(i, value);
            }
            w if w == op("SET") => {
                let value = self.pop(i);
                let id = self.pop(i);
                if (LUA0..=LUA9).contains(&id) {
                    self.threads[i].lua[(id - LUA0) as usize] = value;
                } else {
                    // Kept rather than dropped, so a script that stores its own
                    // state in a unit value reads back what it wrote.
                    self.set_values.insert(id, value);
                }
            }

            // Things a preview cannot do, each said once.
            w if w == op("EMIT_SFX") => {
                self.pop(i);
                self.word(i)?;
                self.model
                    .note("Effects are not drawn in the preview.".to_string());
            }
            w if w == op("EXPLODE") => {
                self.word(i)?;
                self.pop(i);
                self.model
                    .note("Explode throws no debris in the preview.".to_string());
            }
            w if w == op("PLAY_SOUND") => {
                self.word(i)?;
                self.pop(i);
                self.model
                    .note("Sound is not played in the preview.".to_string());
            }
            w if w == op("ATTACH_UNIT") => {
                self.pop(i);
                self.pop(i);
                self.pop(i);
                self.model
                    .note("Attaching a unit does nothing in the preview.".to_string());
            }
            w if w == op("DROP_UNIT") => {
                self.pop(i);
                self.model
                    .note("Attaching a unit does nothing in the preview.".to_string());
            }

            // Renderer hints with one operand each, which the engine also
            // reads and discards.
            w if w == op("CACHE")
                || w == op("DONT_CACHE")
                || w == op("SHADE")
                || w == op("DONT_SHADE") =>
            {
                self.word(i)?;
            }

            _ => {
                return Err(format!(
                    "{}: {:08x} is not an instruction this understands",
                    self.threads[i].origin, word
                ))
            }
        }
        Ok(())
    }

    /// The two operands of a binary opcode, left hand side first. Both are
    /// popped, and the one popped second was pushed first.
    fn operands(&mut self, i: usize) -> (i32, i32) {
        let right = self.pop(i);
        let left = self.pop(i);
        (left, right)
    }

    fn binary(&mut self, i: usize, f: impl Fn(i32, i32) -> i32) {
        let (left, right) = self.operands(i);
        self.push(i, f(left, right));
    }

    fn do_move(&mut self, _i: usize, piece: i32, axis: i32, dest: i32, speed: i32) {
        let (Some(piece), Some(axis)) = (model_piece(&self.program, piece), axis_of(axis)) else {
            return;
        };
        // A move along x goes the other way, which is the first of the engine's
        // three sign flips.
        let dest = if axis == 0 { -dest } else { dest };
        self.model.r#move(
            piece,
            axis,
            f64::from(dest) / COBSCALE,
            f64::from(speed) / COBSCALE,
        );
    }

    fn do_turn(&mut self, _i: usize, piece: i32, axis: i32, dest: i32, speed: i32) {
        let (Some(piece), Some(axis)) = (model_piece(&self.program, piece), axis_of(axis)) else {
            return;
        };
        // A turn about z goes the other way.
        let dest = if axis == 2 { -dest } else { dest };
        self.model.turn(
            piece,
            axis,
            f64::from(dest) * TAANG2RAD,
            f64::from(speed) * TAANG2RAD,
        );
    }

    /// Whether a script is a Lua call-out rather than a script in this file,
    /// which the engine decides from a `lua_` prefix on the name.
    fn is_lua_call(&self, function: usize) -> bool {
        self.program
            .names
            .get(function)
            .is_some_and(|name| name.starts_with("lua_"))
    }

    /// Drop a Lua call's arguments and answer that it failed, which is what the
    /// engine does when there are no Lua rules to call.
    fn lua_call(&mut self, i: usize, args: usize) {
        for _ in 0..args {
            self.pop(i);
        }
        self.threads[i].lua[0] = 0;
        self.model.note(
            "This script calls out to the game's Lua, which the preview does not run.".to_string(),
        );
    }

    /// Call another script in the same file, on the same thread.
    fn call(&mut self, i: usize, function: usize, args: usize) {
        // The engine does not call an empty script at all, and the arguments
        // stay where they are when it does not.
        if self.program.lengths.get(function).copied().unwrap_or(0) == 0 {
            return;
        }
        let stack_top = self.threads[i].data.len().saturating_sub(args);
        let ret = self.threads[i].pc;
        self.threads[i].calls.push(Call {
            ret: Some(ret),
            stack_top,
        });
        self.threads[i].params = args as i32;
        self.threads[i].pc = self.program.offsets[function];
    }

    /// Start another script on a thread of its own.
    ///
    /// It takes on the signal mask of the thread that started it, so a signal
    /// raised later reaches both, and it does not run until the tick that
    /// started it has finished.
    fn start_thread(&mut self, i: usize, function: usize, args: usize) {
        if self.program.lengths.get(function).copied().unwrap_or(0) == 0 {
            for _ in 0..args {
                self.pop(i);
            }
            return;
        }
        let origin = self.threads[i].origin.clone();
        let mask = self.threads[i].mask;
        let mut thread = Thread::new(function, self.program.offsets[function], mask, origin);
        // The arguments move from the parent's stack to the child's, in the
        // order the engine moves them, which reverses them.
        for _ in 0..args {
            let value = self.pop(i);
            thread.data.push(value);
        }
        self.queued.push(thread);
    }

    /// Kill every thread carrying this mask, the one that raised it included.
    ///
    /// The engine does not spare the raiser, and the idiom in every BOS script
    /// relies on that order: `signal` comes before `set-signal-mask`, so a
    /// thread raises a signal while its own mask is still whatever it was.
    fn signal(&mut self, signal: u32) {
        for thread in &mut self.threads {
            if thread.mask & signal != 0 {
                thread.state = State::Dead;
            }
        }
    }

    /// What a script gets when it asks about its unit.
    ///
    /// The two trigonometry call-outs are answered exactly, because they are
    /// arithmetic and a script aiming a barrel needs them. Everything else is
    /// about a world the preview has none of, so it is zero and a note.
    fn unit_value(&mut self, i: usize, id: i32, p1: i32, p2: i32) -> i32 {
        if (LUA0..=LUA9).contains(&id) {
            return self.threads[i].lua[(id - LUA0) as usize];
        }
        match id {
            ATAN => return (RAD2TAANG * f64::from(p1).atan2(f64::from(p2))) as i32,
            HYPOT => return f64::from(p1).hypot(f64::from(p2)) as i32,
            _ => {}
        }
        if let Some(value) = self.set_values.get(&id) {
            return *value;
        }
        // Shared with the Lua runtime, which is asked the same questions by the
        // same numbers and has to give the same answers.
        if let Some(value) = unitvalue::known(id) {
            return value;
        }
        self.model.note(format!(
            "This script asks the world for value {id}, and the preview has no world to ask."
        ));
        0
    }

    /// A deterministic pseudo-random number, so the same preview plays the same
    /// way twice.
    fn next_random(&mut self) -> u64 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        self.rng
    }
}

/// The name of an instruction word, for a message about one that is not.
#[allow(dead_code)]
fn name_of(word: u32) -> &'static str {
    mnemonic(word).unwrap_or("unknown")
}

#[cfg(test)]
#[path = "cobrun_tests.rs"]
mod tests;
