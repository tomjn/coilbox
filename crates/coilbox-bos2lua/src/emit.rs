//! The Lua.
//!
//! Every value keeps the meaning it had in the BOS: a whole number, in 65536ths
//! of a turn for an angle and of an elmo for a distance, where zero is false.
//! Conversion happens only where a number meets the engine. A `turn` becomes a
//! `Turn` in radians, a call-in the engine hands radians gets them back in the
//! BOS's units, and a condition tests `~= 0` rather than trusting Lua, where 0
//! is true.
//!
//! Pieces are converted where they meet the engine too. A piece used as a value
//! is COB's number for it, where the script declares it counted from zero. A
//! number used as a piece looks it up in `PIECES`, the declared pieces in that
//! order, because `piece()` numbers them in the model's order, from one. A
//! piece named outright stays the `piece()` number, so a query call-in whose
//! every answer is a name returns it as it is. The few unit values and gadget
//! calls that take a piece get the model's number, counted from zero, as the
//! engine numbers a Lua script's pieces.

use crate::parse::{self, Axis, Comment, Expr, Func, Item, ItemKind, Stmt, StmtKind};
use crate::pp::{self, Output as Pre};
use crate::{Conversion, Options, Warning};
use coilbox_unitpose::unitvalue::{self, NAMES as COB_NAMES};
use std::collections::{BTreeSet, HashMap, HashSet};

const KEYWORDS: &[&str] = &[
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto", "if", "in",
    "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while",
];

/// The locals `gamedata/unit_script_header.lua` puts in front of every unit
/// script. They count against the script's own limits, which is why they are
/// listed rather than left to the engine.
const HEADER: &[&str] = &[
    "unitID",
    "unitDefID",
    "UnitDef",
    "UnitScript",
    "EmitSfx",
    "Explode",
    "GetUnitValue",
    "SetUnitValue",
    "Hide",
    "Show",
    "Move",
    "Turn",
    "Spin",
    "StopSpin",
    "Scale",
    "MultiSetPieceVisibility",
    "MultiMove",
    "MultiTurn",
    "MultiSpin",
    "MultiStopSpin",
    "MultiExplode",
    "StartThread",
    "Signal",
    "SetSignalMask",
    "Sleep",
    "WaitForMove",
    "WaitForTurn",
    "x_axis",
    "y_axis",
    "z_axis",
];

/// The `explode` flags of the standard `exptype.h`, for a script whose copy of
/// it is missing or older than the one its `.cob` was compiled with. Balanced
/// Annihilation's has no `NOHEATCLOUD`, and its `armamph.cob` holds 128 for it.
/// Numbers rather than the engine's `SFX` names, whose `FALL` is 0 in Lua.
const EXPLODE_FLAGS: &[(&str, i64)] = &[
    ("SHATTER", 1),
    ("EXPLODE_ON_HIT", 2),
    ("FALL", 4),
    ("SMOKE", 8),
    ("FIRE", 16),
    ("BITMAPONLY", 32),
    ("NOCEGTRAIL", 64),
    ("NOHEATCLOUD", 128),
    ("BITMAP1", 256),
    ("BITMAP2", 512),
    ("BITMAP3", 1024),
    ("BITMAP4", 2048),
    ("BITMAP5", 4096),
    ("BITMAPNUKE", 8192),
];

/// Names a script's environment already means something by.
const RESERVED: &[&str] = &[
    "math",
    "string",
    "table",
    "coroutine",
    "script",
    "Spring",
    "COB",
    "SFX",
    "UnitDefs",
    "WeaponDefs",
    "piece",
    "include",
    "GG",
    "System",
    "_G",
    "print",
    "pairs",
    "ipairs",
    "type",
    "tostring",
    "tonumber",
    "next",
    "select",
    "unpack",
    "pcall",
    "error",
    "assert",
    "setmetatable",
    "getmetatable",
    "rawget",
    "rawset",
    "rawequal",
];

/// Lua 5.1's limits, as the engine builds it (`luaconf.h`).
const MAX_UPVALUES: usize = 60;

/// The table of the script's pieces in the order it declares them, which a
/// piece given as a number indexes.
const PIECES: &str = "PIECES";

/// One frame at the engine's 30 a second, in milliseconds, which is how much
/// sooner Lua's `Sleep` wakes than COB's.
const SLEEP_FRAME: u32 = 33;
const MAX_LOCALS: usize = 200;

// Lua's precedence, loosest first.
const P_OR: u8 = 1;
const P_AND: u8 = 2;
const P_CMP: u8 = 3;
const P_ADD: u8 = 5;
const P_MUL: u8 = 6;
const P_UNARY: u8 = 7;
const P_ATOM: u8 = 9;

/// A Lua expression, and what is known about it.
#[derive(Clone)]
struct L {
    text: String,
    prec: u8,
    /// Whether it is a Lua boolean rather than a number.
    boolean: bool,
    /// Its value, when that is known now. For a boolean, 0 or 1.
    value: Option<i64>,
    /// Whether `text` is nothing but that value, so it can be folded.
    literal: bool,
}

impl L {
    fn atom(text: String) -> L {
        L {
            text,
            prec: P_ATOM,
            boolean: false,
            value: None,
            literal: false,
        }
    }

    fn number(v: i64) -> L {
        L {
            text: v.to_string(),
            prec: if v < 0 { P_UNARY } else { P_ATOM },
            boolean: false,
            value: Some(v),
            literal: true,
        }
    }

    fn truth(v: bool) -> L {
        L {
            text: v.to_string(),
            prec: P_ATOM,
            boolean: true,
            value: Some(v as i64),
            literal: true,
        }
    }

    fn wrap(&self, min: u8) -> String {
        if self.prec < min {
            format!("({})", self.text)
        } else {
            self.text.clone()
        }
    }

    /// Minus this, bracketed when it already starts with a minus, since `--`
    /// begins a Lua comment.
    fn negated(&self) -> String {
        let text = self.wrap(P_UNARY);
        if text.starts_with('-') {
            format!("-({text})")
        } else {
            format!("-{text}")
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Weapon {
    Query,
    Aim,
    AimFrom,
    Fire,
    EndBurst,
    Shot,
    BlockShot,
    TargetWeight,
}

/// How one of a call-in's BOS parameters gets its value from the Lua call-in.
#[derive(Clone, Debug)]
enum Init {
    /// Lua argument k, through a template with `{}` for it, or as it is.
    Arg(usize, &'static str),
    /// A template over the Lua arguments, `{0}` for the first.
    Expr(&'static str),
    Zero,
    Value(i64),
}

/// What a call-in hands back to the engine.
#[derive(Clone, Debug, PartialEq)]
enum Ret {
    Nothing,
    /// The parameter the COB wrote its answer into.
    Param(usize),
    /// The parameter the COB wrote a piece into, counted from zero, which Lua
    /// counts from one.
    Piece(usize),
    /// Every parameter, as a list of pieces.
    Pieces,
    /// Whether the BOS returned something other than zero.
    Truthy,
    ParamTruthy(usize),
    /// A weight in 65536ths, as a fraction.
    ParamWeight(usize),
    /// The damage, Lua argument k, scaled by the percentage the BOS returned.
    Damage(usize),
}

#[derive(Clone, Debug)]
struct Spec {
    lua: String,
    args: &'static [&'static str],
    inits: Vec<Init>,
    ret: Ret,
    /// Whether the unit script framework already runs it as a thread.
    threaded: bool,
}

#[derive(Clone, Debug, PartialEq)]
enum Special {
    MoveRate(u8),
    SetSpeed,
    SetDirection,
    SetMaxReloadTime,
}

#[derive(Clone, Debug)]
enum Role {
    Callin(Spec),
    Special(Special),
}

fn spec(
    lua: &str,
    args: &'static [&'static str],
    inits: Vec<Init>,
    ret: Ret,
    threaded: bool,
) -> Option<Role> {
    Some(Role::Callin(Spec {
        lua: format!("script.{lua}"),
        args,
        inits,
        ret,
        threaded,
    }))
}

const WEAPON_STEMS: [&str; 8] = [
    "QueryWeapon",
    "AimFromWeapon",
    "AimWeapon",
    "FireWeapon",
    "EndBurst",
    "Shot",
    "BlockShot",
    "TargetWeight",
];

fn weapon(name: &str) -> Option<(Weapon, u32)> {
    const NUMBERED: [(&str, Weapon); 8] = [
        ("QueryWeapon", Weapon::Query),
        ("AimFromWeapon", Weapon::AimFrom),
        ("AimWeapon", Weapon::Aim),
        ("FireWeapon", Weapon::Fire),
        ("EndBurst", Weapon::EndBurst),
        ("Shot", Weapon::Shot),
        ("BlockShot", Weapon::BlockShot),
        ("TargetWeight", Weapon::TargetWeight),
    ];
    for (prefix, kind) in NUMBERED {
        if let Some(n) = name.strip_prefix(prefix) {
            if !n.starts_with('0') {
                if let Ok(n) = n.parse::<u32>() {
                    if (1..=32).contains(&n) {
                        return Some((kind, n));
                    }
                }
            }
        }
    }
    const OLD: [(&str, Weapon); 4] = [
        ("Query", Weapon::Query),
        ("AimFrom", Weapon::AimFrom),
        ("Aim", Weapon::Aim),
        ("Fire", Weapon::Fire),
    ];
    for (n, ordinal) in ["Primary", "Secondary", "Tertiary"].iter().enumerate() {
        for (prefix, kind) in OLD {
            if name == format!("{prefix}{ordinal}") {
                return Some((kind, n as u32 + 1));
            }
        }
    }
    None
}

/// What the engine does with a BOS function of this name. Matched exactly, as
/// the engine matches it: `SetSFXOccupy` is not `setSFXoccupy`, and a COB with
/// the first never has it called.
fn role(name: &str) -> Option<Role> {
    use Init::*;
    if let Some((kind, n)) = weapon(name) {
        let lua = |stem: &str| format!("{stem}{n}");
        return match kind {
            Weapon::Query => spec(&lua("QueryWeapon"), &[], vec![Zero], Ret::Piece(0), false),
            Weapon::AimFrom => spec(&lua("AimFromWeapon"), &[], vec![Zero], Ret::Piece(0), false),
            Weapon::Aim => spec(
                &lua("AimWeapon"),
                &["heading", "pitch"],
                vec![Arg(0, "toCobAngle({})"), Arg(1, "toCobAngle({})")],
                Ret::Truthy,
                true,
            ),
            Weapon::Fire => spec(&lua("FireWeapon"), &[], vec![], Ret::Nothing, true),
            Weapon::EndBurst => spec(&lua("EndBurst"), &[], vec![], Ret::Nothing, false),
            Weapon::Shot => spec(&lua("Shot"), &[], vec![Zero], Ret::Nothing, false),
            Weapon::BlockShot => spec(
                &lua("BlockShot"),
                &["targetID", "userTarget"],
                vec![Arg(0, ""), Zero, Arg(1, "{} and 1 or 0")],
                Ret::ParamTruthy(1),
                false,
            ),
            Weapon::TargetWeight => spec(
                &lua("TargetWeight"),
                &["targetID"],
                vec![Arg(0, ""), Value(65536)],
                Ret::ParamWeight(1),
                false,
            ),
        };
    }
    let height = "trunc(Spring.GetUnitHeight({0}) * 65536)";
    match name {
        "Create" => spec("Create", &[], vec![], Ret::Nothing, true),
        "Killed" => spec(
            "Killed",
            &["recentDamage", "maxHealth"],
            vec![Expr("math.floor({0} / {1} * 100)"), Zero],
            Ret::Param(1),
            true,
        ),
        "StartMoving" => spec(
            "StartMoving",
            &["reversing"],
            vec![Arg(0, "{} and 1 or 0")],
            Ret::Nothing,
            false,
        ),
        "StopMoving" | "Activate" | "Deactivate" => spec(name, &[], vec![], Ret::Nothing, false),
        "setSFXoccupy" => spec(
            name,
            &["terrainType"],
            vec![Arg(0, "")],
            Ret::Nothing,
            false,
        ),
        "StartBuilding" => spec(
            name,
            &["heading", "pitch"],
            vec![Arg(0, "toCobAngle({} or 0)"), Arg(1, "toCobAngle({} or 0)")],
            Ret::Nothing,
            true,
        ),
        "StopBuilding" | "Falling" | "Landed" | "StartUnload" | "EndTransport" => {
            spec(name, &[], vec![], Ret::Nothing, true)
        }
        "QueryNanoPiece" | "QueryBuildInfo" => spec(name, &[], vec![Zero], Ret::Piece(0), false),
        "QueryLandingPad" => spec("QueryLandingPads", &[], vec![], Ret::Pieces, false),
        "BeginTransport" => spec(
            name,
            &["passengerID"],
            vec![Expr(height)],
            Ret::Nothing,
            true,
        ),
        "QueryTransport" => spec(
            name,
            &["passengerID"],
            vec![Zero, Expr(height)],
            Ret::Piece(0),
            false,
        ),
        "TransportPickup" => spec(name, &["passengerID"], vec![Arg(0, "")], Ret::Nothing, true),
        "TransportDrop" => spec(
            name,
            &["passengerID", "x", "y", "z"],
            vec![Arg(0, ""), Expr("trunc({1}) * 65536 + trunc({3}) % 65536")],
            Ret::Nothing,
            true,
        ),
        "HitByWeapon" => spec(
            name,
            &["x", "z", "weaponDefID", "damage"],
            vec![Expr("trunc({1} * 500)"), Expr("trunc({0} * 500)")],
            Ret::Nothing,
            false,
        ),
        "HitByWeaponId" => spec(
            "HitByWeapon",
            &["x", "z", "weaponDefID", "damage"],
            vec![
                Expr("trunc({1} * 500)"),
                Expr("trunc({0} * 500)"),
                Arg(2, ""),
                Expr("trunc({3} * 100)"),
            ],
            Ret::Damage(3),
            false,
        ),
        "RockUnit" => spec(
            name,
            &["x", "z"],
            vec![Expr("trunc({1} * 500)"), Expr("trunc({0} * 500)")],
            Ret::Nothing,
            true,
        ),
        "MoveRate0" | "MoveRate1" | "MoveRate2" | "MoveRate3" => {
            Some(Role::Special(Special::MoveRate(name.as_bytes()[8] - b'0')))
        }
        "SetSpeed" => Some(Role::Special(Special::SetSpeed)),
        "SetDirection" => Some(Role::Special(Special::SetDirection)),
        "SetMaxReloadTime" => Some(Role::Special(Special::SetMaxReloadTime)),
        _ => None,
    }
}

/// What the engine answers for a call-in whose COB waits before it finishes.
/// The engine runs a call-in until it first waits, and if it has not finished
/// by then `RealCall` leaves the arguments it handed over as they were
/// (`CobInstance.cpp:592-617`). The call-in reads its answer from those.
enum Unfinished {
    /// Script piece n. `QueryWeapon` hands over 1, the count of arguments, in
    /// the slot it reads the piece from (`CobInstance.cpp:437-446`), and
    /// `QueryTransport` hands over 2 (`CobInstance.cpp:363-373`).
    Piece(usize),
    /// A template over the Lua call-in's arguments, and what it means.
    Expr(&'static str, &'static str),
}

/// `None` for `QueryLandingPad`, which reads its pieces from slots the engine
/// never sets (`CobInstance.cpp:327-352`), so no Lua can give the same answer.
fn unfinished(spec: &Spec) -> Option<Unfinished> {
    match &spec.ret {
        Ret::Piece(_) if spec.lua == "script.QueryTransport" => Some(Unfinished::Piece(2)),
        Ret::Piece(_) => Some(Unfinished::Piece(1)),
        // BlockShot and TargetWeight read the target's ID back
        // (`CobInstance.cpp:496-523`).
        Ret::ParamTruthy(_) => Some(Unfinished::Expr(
            "({0} or 0) ~= 0",
            "a blocked shot when there is a target",
        )),
        Ret::ParamWeight(_) => Some(Unfinished::Expr(
            "({0} or 0) / 65536",
            "the target's ID as the weight",
        )),
        // HitByWeaponId's percentage starts at 1 (`CobInstance.cpp:309-313`).
        Ret::Damage(_) => Some(Unfinished::Expr("{3} / 100", "1% of the damage")),
        Ret::Param(_) | Ret::Pieces | Ret::Truthy | Ret::Nothing => None,
    }
}

/// A template with `{}` or `{0}`, `{1}` filled in.
fn fill(template: &str, args: &[String]) -> String {
    let mut out = template.to_string();
    for (i, a) in args.iter().enumerate() {
        out = out.replace(&format!("{{{i}}}"), a);
    }
    if let Some(first) = args.first() {
        out = out.replace("{}", first);
    }
    out
}

struct FuncInfo {
    lua: String,
    role: Option<Role>,
    blocks: bool,
    called: bool,
    /// The fewest arguments anything passes it.
    min_args: Option<usize>,
    /// Written straight out as `script.X` rather than as a function of its own
    /// with a call-in handing on to it.
    direct: bool,
    /// A call-in the engine wants an answer from at once, whose BOS waits
    /// first. It is written as a function of its own, which the call-in runs
    /// as a thread.
    waits: bool,
    /// Whether it begins a script with `start-script`, itself or in a function
    /// it calls. Whatever runs it has to start those once it waits or finishes.
    starts: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Mode {
    pieces_global: bool,
    statics_global: bool,
    consts_global: bool,
}

const MODES: [Mode; 4] = [
    Mode {
        pieces_global: false,
        statics_global: false,
        consts_global: false,
    },
    Mode {
        pieces_global: true,
        statics_global: false,
        consts_global: false,
    },
    Mode {
        pieces_global: true,
        statics_global: true,
        consts_global: false,
    },
    Mode {
        pieces_global: true,
        statics_global: true,
        consts_global: true,
    },
];

pub fn emit(items: &[Item], pre: &Pre, options: &Options) -> Result<Conversion, String> {
    let program = Program::new(items, pre, options);
    let mut last = None;
    for mode in MODES {
        let mut w = Writer::new(&program, mode);
        w.program(items);
        let fits = w.fits();
        let result = w.finish();
        if fits {
            return Ok(result);
        }
        last = Some(result);
    }
    let mut result = last.expect("at least one mode");
    result.warnings.push(Warning::unlocated(format!(
        "Even with its pieces, variables and constants made global, a function here uses more than Lua's {MAX_UPVALUES} outside names, so the engine will refuse to load it."
    )));
    Ok(result)
}

/// What is known about the script before a line of Lua is written.
struct Program<'a> {
    pre: &'a Pre,
    options: &'a Options<'a>,
    /// Lower-cased BOS name to (Lua name, the name `piece()` is asked for).
    pieces: Vec<(String, String, String)>,
    /// Every piece the script declares, in its order, which is how COB numbers
    /// them: lower-cased BOS name and the model's name, or none for a piece the
    /// model does not have. Kept whole when unused pieces are left out.
    declared: Vec<(String, Option<String>)>,
    statics: Vec<(String, String)>,
    funcs: HashMap<String, FuncInfo>,
    /// BOS function names in the order they are defined.
    func_order: Vec<String>,
    /// Files that hold code rather than only `#define`s.
    code_files: HashSet<usize>,
    /// Constants the engine's own `COB` table already names, with the same value.
    cob_names: HashMap<String, i64>,
    taken: HashSet<String>,
    warnings: Vec<Warning>,
    /// Whether the script has a SetMaxReloadTime, whose call-in shares
    /// `script.Create` with Create itself.
    has_reload: bool,
    /// The functions left out because nothing can reach them, lower-cased.
    dropped: HashSet<String>,
    /// Whether anything begins a script with `start-script`, whose start the
    /// Lua holds back until the thread that began it waits or finishes.
    defers: bool,
    /// Whether two of the script's threads can be waiting at once, so the Lua
    /// runs them as coroutines of its own to wake them in COB's order.
    scheduled: bool,
    /// The constants something that is written uses, when leaving out the rest.
    live_consts: Option<HashSet<String>>,
    /// The constants declared in radians or elmos.
    units: HashMap<String, Unit>,
}

fn sanitise(want: &str, taken: &HashSet<String>) -> String {
    let mut name = want.to_string();
    while KEYWORDS.contains(&name.as_str())
        || HEADER.contains(&name.as_str())
        || RESERVED.contains(&name.as_str())
        || Writer::HELPER_NAMES.contains(&name.as_str())
        || taken.contains(&name)
    {
        name.push('_');
    }
    name
}

/// Every expression a statement reads, not counting the statements inside it.
pub(crate) fn exprs_in(k: &StmtKind) -> Vec<&Expr> {
    match k {
        StmtKind::Assign(_, e)
        | StmtKind::Sleep(e)
        | StmtKind::Signal(e)
        | StmtKind::SetSignalMask(e)
        | StmtKind::Get(e)
        | StmtKind::DropUnit(e)
        | StmtKind::Explode(_, e)
        | StmtKind::EmitSfx(e, _)
        | StmtKind::PlaySound(_, e)
        | StmtKind::If { cond: e, .. }
        | StmtKind::While { cond: e, .. }
        | StmtKind::For { cond: Some(e), .. } => vec![e],
        StmtKind::Set(a, b) | StmtKind::AttachUnit(a, b) => vec![a, b],
        StmtKind::Call(_, args) | StmtKind::Start(_, args) => args.iter().collect(),
        StmtKind::Return(Some(e)) => vec![e],
        StmtKind::Spin { speed, accel, .. } => std::iter::once(speed).chain(accel).collect(),
        StmtKind::StopSpin { decel, .. } => decel.iter().collect(),
        StmtKind::Turn { dest, speed, .. }
        | StmtKind::Move { dest, speed, .. }
        | StmtKind::Scale { dest, speed, .. } => std::iter::once(dest).chain(speed).collect(),
        StmtKind::MissionCommand(args) => args.iter().collect(),
        _ => Vec::new(),
    }
}

fn mentions(e: &Expr, name: &str) -> bool {
    match e {
        Expr::Name(n) => n.eq_ignore_ascii_case(name),
        Expr::Get(a, args) => mentions(a, name) || args.iter().any(|x| mentions(x, name)),
        Expr::Rand(a, b) | Expr::Bin(_, a, b) => mentions(a, name) || mentions(b, name),
        Expr::Not(a) | Expr::Neg(a) => mentions(a, name),
        _ => false,
    }
}

/// Whether a loop's own body uses `continue`, not counting loops inside it.
fn continues(body: &[Stmt]) -> bool {
    body.iter().any(|s| match &s.kind {
        StmtKind::Continue => true,
        StmtKind::If { then, els, .. } => {
            continues(then) || els.as_ref().is_some_and(|(els, _)| continues(els))
        }
        StmtKind::Block(body, _) => continues(body),
        _ => false,
    })
}

/// Whether a function only ever sets `param` to a piece by name and never
/// reads it, which is how nearly every query call-in names its piece.
fn piece_only(body: &[Stmt], param: &str, is_piece: &dyn Fn(&str) -> bool) -> bool {
    let mut ok = true;
    walk(body, &mut |k| {
        match k {
            StmtKind::Assign(n, e) if n.eq_ignore_ascii_case(param) => {
                if !matches!(e, Expr::Name(x) if is_piece(x)) {
                    ok = false;
                }
            }
            StmtKind::Inc(n) | StmtKind::Dec(n) if n.eq_ignore_ascii_case(param) => ok = false,
            _ => {}
        }
        if exprs_in(k).iter().any(|e| mentions(e, param)) {
            ok = false;
        }
    });
    ok
}

fn walk<'s>(stmts: &'s [Stmt], f: &mut impl FnMut(&'s StmtKind)) {
    for s in stmts {
        f(&s.kind);
        match &s.kind {
            StmtKind::If { then, els, .. } => {
                walk(then, f);
                if let Some((els, _)) = els {
                    walk(els, f);
                }
            }
            StmtKind::While { body, .. } | StmtKind::Block(body, _) => walk(body, f),
            StmtKind::For {
                init, step, body, ..
            } => {
                for clause in [init, step].into_iter().flatten() {
                    walk(std::slice::from_ref(clause.as_ref()), f);
                }
                walk(body, f);
            }
            _ => {}
        }
    }
}

/// Every name an expression reads, lower-cased, and every constant, as written.
pub(crate) fn names_in(e: &Expr, names: &mut HashSet<String>, consts: &mut HashSet<String>) {
    match e {
        Expr::Name(n) => {
            names.insert(n.to_lowercase());
        }
        Expr::Const(n) => {
            consts.insert(n.clone());
        }
        Expr::Get(a, args) => {
            names_in(a, names, consts);
            for x in args {
                names_in(x, names, consts);
            }
        }
        Expr::Rand(a, b) | Expr::Bin(_, a, b) => {
            names_in(a, names, consts);
            names_in(b, names, consts);
        }
        Expr::Not(a) | Expr::Neg(a) => names_in(a, names, consts),
        Expr::Num(_) | Expr::Angle(..) | Expr::Linear(..) => {}
    }
}

/// The name a statement itself writes to or moves, if it has one.
fn target_of(k: &StmtKind) -> Option<&str> {
    match k {
        StmtKind::Assign(n, _)
        | StmtKind::Inc(n)
        | StmtKind::Dec(n)
        | StmtKind::Spin { piece: n, .. }
        | StmtKind::StopSpin { piece: n, .. }
        | StmtKind::Turn { piece: n, .. }
        | StmtKind::Move { piece: n, .. }
        | StmtKind::Scale { piece: n, .. }
        | StmtKind::WaitTurn(n, _)
        | StmtKind::WaitMove(n, _)
        | StmtKind::WaitScale(n)
        | StmtKind::EmitSfx(_, n)
        | StmtKind::Hide(n)
        | StmtKind::Show(n)
        | StmtKind::Explode(n, _) => Some(n),
        _ => None,
    }
}

/// Whether working an expression out changes nothing. A `get` may be one of
/// the setters, and `rand` moves the synced generator every unit shares.
fn pure(e: &Expr) -> bool {
    match e {
        Expr::Get(..) | Expr::Rand(..) => false,
        Expr::Bin(_, a, b) => pure(a) && pure(b),
        Expr::Not(a) | Expr::Neg(a) => pure(a),
        _ => true,
    }
}

/// A constant kept in Lua's own units, because every use of it is one.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Unit {
    /// The degrees as written.
    Angle(f64),
    /// The brackets as written, which [`Writer::elmos_per_bracket`] sizes.
    Linear(f64),
}

impl Unit {
    /// The unit a constant's whole value is written in, if it is one. A half
    /// turn is left out, since that one keeps the BOS's value: see `turn_to`.
    fn of(e: &Expr) -> Option<Unit> {
        match e {
            Expr::Angle(deg, _) if deg.rem_euclid(360.0) != 180.0 => Some(Unit::Angle(*deg)),
            Expr::Linear(v, _) => Some(Unit::Linear(*v)),
            Expr::Neg(inner) => match Unit::of(inner)? {
                Unit::Angle(deg) => Some(Unit::Angle(-deg)),
                Unit::Linear(v) => Some(Unit::Linear(-v)),
            },
            _ => None,
        }
    }
}

/// The constant an operand is, alone or with a minus in front, and whether it
/// has the minus.
fn bare_const(e: &Expr) -> Option<(&str, bool)> {
    match e {
        Expr::Const(n) => Some((n, false)),
        Expr::Neg(inner) => match &**inner {
            Expr::Const(n) => Some((n, true)),
            _ => None,
        },
        _ => None,
    }
}

/// The functions nothing can reach, lower-cased. What can be reached starts
/// from the call-ins and from every function in the script's own file, since
/// a gadget may call one of those by name. A `lua_` function is never one of
/// them: `call-script` on it goes to LuaRules and never runs its body.
fn unreachable(funcs: &[(&Func, usize)], infos: &HashMap<String, FuncInfo>) -> HashSet<String> {
    let mut edges: HashMap<String, Vec<String>> = HashMap::new();
    let mut reached: Vec<String> = Vec::new();
    for (f, file) in funcs {
        let lower = f.name.to_lowercase();
        let callees = edges.entry(lower.clone()).or_default();
        walk(&f.body, &mut |k| match k {
            StmtKind::Call(name, _) if name.starts_with("lua_") => {}
            StmtKind::Call(name, _) | StmtKind::Start(name, _) => callees.push(name.to_lowercase()),
            _ => {}
        });
        let called_in = infos.get(&lower).is_some_and(|info| info.role.is_some());
        if called_in || (*file == 0 && !f.name.starts_with("lua_")) {
            reached.push(lower);
        }
    }
    let mut live: HashSet<String> = HashSet::new();
    while let Some(name) = reached.pop() {
        if live.insert(name.clone()) {
            reached.extend(edges.get(&name).into_iter().flatten().cloned());
        }
    }
    edges
        .into_keys()
        .filter(|name| !live.contains(name))
        .collect()
}

/// How many threads that can wait these statements begin with `start-script`,
/// counting one in a loop as two, since it can begin more than one.
fn started_waiters(stmts: &[Stmt], looped: bool, blocking: &HashSet<String>) -> usize {
    stmts
        .iter()
        .map(|s| match &s.kind {
            StmtKind::Start(name, _) if blocking.contains(&name.to_lowercase()) => {
                1 + usize::from(looped)
            }
            StmtKind::If { then, els, .. } => {
                started_waiters(then, looped, blocking)
                    + els
                        .as_ref()
                        .map_or(0, |(els, _)| started_waiters(els, looped, blocking))
            }
            StmtKind::While { body, .. } | StmtKind::For { body, .. } => {
                started_waiters(body, true, blocking)
            }
            StmtKind::Block(body, _) => started_waiters(body, looped, blocking),
            _ => 0,
        })
        .sum()
}

/// The `var`s of a function that are set and never read, lower-cased, when
/// leaving out every line that sets them changes nothing.
fn dead_locals(f: &Func) -> HashSet<String> {
    let mut declared: HashSet<String> = HashSet::new();
    let mut read: HashSet<String> = HashSet::new();
    let mut kept: HashSet<String> = HashSet::new();
    walk(&f.body, &mut |k| {
        if let StmtKind::Var(names) = k {
            declared.extend(names.iter().map(|n| n.to_lowercase()));
        }
        for e in exprs_in(k) {
            names_in(e, &mut read, &mut HashSet::new());
        }
        match k {
            StmtKind::Assign(_, e) if pure(e) => {}
            StmtKind::Inc(_) | StmtKind::Dec(_) => {}
            _ => kept.extend(target_of(k).map(str::to_lowercase)),
        }
    });
    for p in &f.params {
        declared.remove(&p.to_lowercase());
    }
    declared
        .into_iter()
        .filter(|n| !read.contains(n) && !kept.contains(n))
        .collect()
}

impl<'a> Program<'a> {
    fn new(items: &'a [Item], pre: &'a Pre, options: &'a Options<'a>) -> Self {
        let mut p = Program {
            pre,
            options,
            pieces: Vec::new(),
            declared: Vec::new(),
            statics: Vec::new(),
            funcs: HashMap::new(),
            func_order: Vec::new(),
            code_files: HashSet::new(),
            cob_names: COB_NAMES
                .iter()
                .map(|(name, id)| (name.to_string(), i64::from(*id)))
                .collect(),
            taken: HashSet::new(),
            warnings: pre.warnings.clone(),
            has_reload: false,
            defers: false,
            scheduled: false,
            dropped: HashSet::new(),
            live_consts: None,
            units: HashMap::new(),
        };
        let mut seen: HashSet<String> = HashSet::new();
        let mut funcs: Vec<(&Func, usize)> = Vec::new();
        let mut piece_warnings: HashMap<String, String> = HashMap::new();
        for item in items {
            match &item.kind {
                ItemKind::Pieces(names) => {
                    p.code_files.insert(item.file);
                    for name in names {
                        if !seen.insert(name.to_lowercase()) {
                            continue;
                        }
                        let lua = sanitise(name, &p.taken);
                        p.taken.insert(lua.clone());
                        let model = match options.pieces {
                            Some(model) => {
                                match model.iter().find(|m| m.eq_ignore_ascii_case(name)) {
                                    Some(found) => found.clone(),
                                    None => {
                                        let warning = format!(
                                        "The script names a piece called {name} that the model does not have, so the engine will refuse to load it."
                                    );
                                        piece_warnings.insert(name.to_lowercase(), warning.clone());
                                        p.warnings.push(Warning::unlocated(warning));
                                        name.clone()
                                    }
                                }
                            }
                            None => name.clone(),
                        };
                        let known = !piece_warnings.contains_key(&name.to_lowercase());
                        p.declared
                            .push((name.to_lowercase(), known.then(|| model.clone())));
                        p.pieces.push((name.to_lowercase(), lua, model));
                    }
                }
                ItemKind::Statics(names) => {
                    p.code_files.insert(item.file);
                    for name in names {
                        if !seen.insert(name.to_lowercase()) {
                            continue;
                        }
                        let lua = sanitise(name, &p.taken);
                        p.taken.insert(lua.clone());
                        p.statics.push((name.to_lowercase(), lua));
                    }
                }
                ItemKind::Func(f) => {
                    p.code_files.insert(item.file);
                    funcs.push((f, item.file));
                }
                _ => {}
            }
        }
        for (name, c) in &pre.constants {
            if p.cob_names.get(name) != Some(&c.value) {
                p.taken.insert(name.clone());
            }
        }

        // Roles, with the engine's own tie-breaks: the numbered weapon name
        // wins over the old one, and HitByWeaponId over HitByWeapon.
        let names: HashSet<&str> = funcs.iter().map(|(f, _)| f.name.as_str()).collect();
        let mut claimed: HashMap<String, String> = HashMap::new();
        for (f, _) in &funcs {
            let lower = f.name.to_lowercase();
            if p.funcs.contains_key(&lower) {
                continue;
            }
            let mut role = role(&f.name);
            if f.name == "HitByWeapon" && names.contains("HitByWeaponId") {
                role = None;
            }
            let key = match &role {
                Some(Role::Callin(s)) => Some(s.lua.clone()),
                _ => None,
            };
            if let Some(key) = key {
                if let Some(other) = claimed.get(&key) {
                    let (keep, drop) = if weapon(other).is_some_and(|_| other.contains("Weapon")) {
                        (other.clone(), f.name.clone())
                    } else {
                        (f.name.clone(), other.clone())
                    };
                    p.warnings.push(Warning::unlocated(format!(
                        "{keep} and {drop} are the same call-in. The engine calls {keep} and {drop} becomes an ordinary function."
                    )));
                    if keep == f.name {
                        if let Some(info) = p.funcs.get_mut(&other.to_lowercase()) {
                            info.role = None;
                        }
                    } else {
                        role = None;
                    }
                }
                if role.is_some() {
                    claimed.insert(key, f.name.clone());
                }
            }
            let lua = sanitise(&f.name, &p.taken);
            p.taken.insert(lua.clone());
            p.func_order.push(lower.clone());
            p.funcs.insert(
                lower,
                FuncInfo {
                    lua,
                    role,
                    blocks: false,
                    called: false,
                    min_args: None,
                    direct: false,
                    waits: false,
                    starts: false,
                },
            );
        }
        if (1..=32).any(|n| claimed.contains_key(&format!("script.QueryWeapon{n}")))
            && !claimed.contains_key("script.AimWeapon1")
        {
            p.warnings.push(Warning::unlocated(
                "The unit script framework only hands weapon call-ins on when AimWeapon1 exists, and this script has none, so its weapons will not aim.".into(),
            ));
        }

        if options.prune {
            p.prune(&funcs, &piece_warnings);
        }
        p.units = p.unit_constants(&funcs);

        // Who calls whom, and with how many arguments.
        let mut blocks_directly: HashMap<String, bool> = HashMap::new();
        let mut starting: HashSet<String> = HashSet::new();
        let mut calls: HashMap<String, Vec<String>> = HashMap::new();
        for (f, _) in &funcs {
            let lower = f.name.to_lowercase();
            if p.dropped.contains(&lower) {
                continue;
            }
            let mut blocks = false;
            let mut starts = false;
            let mut callees = Vec::new();
            walk(&f.body, &mut |k| match k {
                StmtKind::Sleep(_)
                | StmtKind::WaitTurn(..)
                | StmtKind::WaitMove(..)
                | StmtKind::WaitScale(_) => blocks = true,
                StmtKind::Call(name, args) | StmtKind::Start(name, args) => {
                    starts |= matches!(k, StmtKind::Start(..));
                    let callee = name.to_lowercase();
                    if let Some(info) = p.funcs.get_mut(&callee) {
                        info.called = true;
                        info.min_args =
                            Some(info.min_args.map_or(args.len(), |m| m.min(args.len())));
                    }
                    if matches!(k, StmtKind::Call(..)) {
                        callees.push(callee);
                    }
                }
                _ => {}
            });
            blocks_directly.insert(lower.clone(), blocks);
            if starts {
                starting.insert(lower.clone());
            }
            calls.insert(lower, callees);
        }
        let mut blocking: HashSet<String> = blocks_directly
            .iter()
            .filter(|(_, b)| **b)
            .map(|(n, _)| n.clone())
            .collect();
        p.defers = !starting.is_empty();
        for set in [&mut blocking, &mut starting] {
            loop {
                let before = set.len();
                for (name, callees) in &calls {
                    if callees.iter().any(|c| set.contains(c)) {
                        set.insert(name.clone());
                    }
                }
                if set.len() == before {
                    break;
                }
            }
        }
        let mut waiting = 0;
        for (f, _) in &funcs {
            let lower = f.name.to_lowercase();
            if p.dropped.contains(&lower) {
                continue;
            }
            if blocking.contains(&lower) && p.funcs[&lower].role.is_some() {
                waiting += 1;
            }
            waiting += started_waiters(&f.body, false, &blocking);
        }
        p.scheduled = waiting >= 2;
        let has_reload = p
            .funcs
            .values()
            .any(|f| matches!(f.role, Some(Role::Special(Special::SetMaxReloadTime))));
        p.has_reload = has_reload;
        for (name, info) in p.funcs.iter_mut() {
            info.blocks = blocking.contains(name);
            info.starts = starting.contains(name);
            if let Some(Role::Callin(s)) = &info.role {
                if s.ret != Ret::Nothing && info.blocks && !s.threaded {
                    info.waits = unfinished(s).is_some();
                    if !info.waits {
                        p.warnings.push(Warning::unlocated(format!(
                            "{} waits, but the engine wants its answer at once, so it will stop with an error the first time it waits.",
                            info.lua
                        )));
                    }
                }
            }
            info.direct = match &info.role {
                Some(Role::Callin(s)) if s.ret != Ret::Nothing => {
                    if info.called && !info.waits {
                        p.warnings.push(Warning::unlocated(format!(
                            "The script calls {} itself. The Lua calls the engine's {} instead, which gets the same answer.",
                            info.lua, s.lua
                        )));
                    }
                    true
                }
                Some(Role::Callin(s)) if s.lua == "script.Create" && has_reload => false,
                // Its BOS runs as one of the Lua's own threads.
                Some(Role::Callin(_)) if p.scheduled => {
                    !info.called && !info.blocks && !info.starts
                }
                Some(Role::Callin(s)) => !info.called && (s.threaded || !info.blocks),
                _ => false,
            };
        }
        p
    }

    /// Leaves out the functions nothing can reach, then the pieces, variables
    /// and constants that only they named.
    fn prune(&mut self, funcs: &[(&Func, usize)], piece_warnings: &HashMap<String, String>) {
        self.dropped = unreachable(funcs, &self.funcs);
        let mut names: HashSet<String> = HashSet::new();
        let mut consts: HashSet<String> = HashSet::new();
        let mut said: HashSet<String> = HashSet::new();
        for (f, file) in funcs {
            let lower = f.name.to_lowercase();
            if self.dropped.contains(&lower) {
                if !f.name.starts_with("lua_") && said.insert(lower) {
                    self.warnings.push(Warning::unlocated(format!(
                        "{} in {} is never called, so the Lua leaves it out. If a gadget calls it by name, convert with unused code kept.",
                        f.name, self.pre.files[*file]
                    )));
                }
                continue;
            }
            walk(&f.body, &mut |k| {
                names.extend(target_of(k).map(str::to_lowercase));
                for e in exprs_in(k) {
                    names_in(e, &mut names, &mut consts);
                }
            });
        }
        // A constant may be made of others.
        let mut pending: Vec<String> = consts.iter().cloned().collect();
        while let Some(name) = pending.pop() {
            let Some(c) = self.pre.constants.get(&name) else {
                continue;
            };
            for t in &c.body {
                if self.pre.constants.contains_key(&t.text) && consts.insert(t.text.clone()) {
                    pending.push(t.text.clone());
                }
            }
        }
        self.live_consts = Some(consts);

        let gone: HashSet<&String> = self
            .pieces
            .iter()
            .filter(|(bos, _, _)| !names.contains(bos))
            .filter_map(|(bos, _, _)| piece_warnings.get(bos))
            .collect();
        self.warnings.retain(|w| !gone.contains(&w.message));
        self.pieces.retain(|(bos, _, _)| names.contains(bos));
        self.statics.retain(|(bos, _)| names.contains(bos));
    }

    /// The constants that are an angle or a distance and nothing else: written
    /// as one `<x>` or `[x]`, and only ever the whole of a turn, spin or move's
    /// angle, distance or speed. One that is also compared, summed, handed to
    /// the engine or built into another constant stays in the BOS's units.
    fn unit_constants(&self, funcs: &[(&Func, usize)]) -> HashMap<String, Unit> {
        let mut units: HashMap<String, Unit> = HashMap::new();
        let mut other: HashSet<String> = HashSet::new();
        for (name, c) in &self.pre.constants {
            let whole =
                parse::expression(&c.body, self.options.linear_scale, self.options.precedence);
            if let Some(unit) = whole.ok().as_ref().and_then(Unit::of) {
                units.insert(name.clone(), unit);
            }
            other.extend(
                c.body
                    .iter()
                    .filter(|t| self.pre.constants.contains_key(&t.text))
                    .map(|t| t.text.clone()),
            );
        }
        for (f, _) in funcs {
            if self.dropped.contains(&f.name.to_lowercase()) {
                continue;
            }
            walk(&f.body, &mut |k| {
                let angles = match k {
                    StmtKind::Spin { .. } | StmtKind::StopSpin { .. } | StmtKind::Turn { .. } => {
                        Some(true)
                    }
                    StmtKind::Move { .. } | StmtKind::Scale { .. } => Some(false),
                    _ => None,
                };
                for e in exprs_in(k) {
                    let fits = bare_const(e)
                        .and_then(|(n, _)| units.get(n))
                        .is_some_and(|unit| match unit {
                            Unit::Angle(_) => angles == Some(true),
                            Unit::Linear(_) => angles == Some(false),
                        });
                    if !fits {
                        names_in(e, &mut HashSet::new(), &mut other);
                    }
                }
            });
        }
        units.retain(|name, _| !other.contains(name));
        units
    }

    fn visible(&self, file: usize) -> bool {
        file == 0 || self.code_files.contains(&file)
    }
}

/// The Lua that keeps the shared unit values the engine stopped keeping.
/// The helpers that hold a `start-script` back, any one of which needs the
/// queue and the functions that empty it.
const STARTING_HELPERS: &[&str] = &[
    "startScript",
    "callStarting",
    "Sleep",
    "WaitForTurn",
    "WaitForMove",
    "WaitForScale",
    "startsHeld",
    "signal",
    "setSignalMask",
];

const STARTING: &str = "
-- COB runs a script begun with start-script once the thread that began it
-- waits or finishes (CobThread.cpp:372-388), and not before the next frame, or
-- the one after if that thread woke from a sleep to begin it (CobEngine.cpp:
-- 92-105,173-200). StartThread runs it at once. So each one waits here until
-- then, and starts in the order it was begun with the signal mask its thread
-- had when it began it. One sleeping thread starts every one due on a frame,
-- because the engine's Lua wakes threads due together last asleep first
-- (unit_script.lua:812-836).
local starting = {}
local startsHeld = false
local woke = false
local masks = setmetatable({}, {__mode = \"k\"})
local due = {}
local startScripts
local function runStarted(mask, fn, ...)
\twoke = false
\tSetSignalMask(mask)
\tmasks[coroutine.running()] = mask
\tfn(...)
\tstartScripts()
end
function startScripts()
\tif #starting == 0 or startsHeld then return end
\tlocal frame = Spring.GetGameFrame() + (woke and 2 or 1)
\tlocal list = due[frame]
\tif not list then
\t\tlist = {}
\t\tdue[frame] = list
\t\tStartThread(function()
\t\t\tSetSignalMask(0)
\t\t\tUnitScript.Sleep((frame - Spring.GetGameFrame()) * 33)
\t\t\tdue[frame] = nil
\t\t\tfor i = 1, #list do
\t\t\t\tif not list[i].dead then
\t\t\t\t\tStartThread(runStarted, list[i].mask, unpack(list[i]))
\t\t\t\tend
\t\t\tend
\t\tend)
\tend
\tfor i = 1, #starting do
\t\tlist[#list + 1] = starting[i]
\tend
\tstarting = {}
end
";

const START_SCRIPT: &str = "local function startScript(...)
\tstarting[#starting + 1] = {mask = masks[coroutine.running()] or 0, ...}
end
";

const SET_SIGNAL_MASK: &str = "local function setSignalMask(mask)
\tSetSignalMask(mask)
\tmasks[coroutine.running()] = mask
end
";

const SIGNAL: &str =
    "-- A signal also reaches a script begun before it that has yet to start, which
-- the engine has added to the unit's threads (CobInstance.cpp:625,744-756).
local function signal(mask)
\tSignal(mask)
\tfor _, list in pairs(due) do
\t\tfor i = 1, #list do
\t\t\tif math.bit_and(list[i].mask, mask) ~= 0 then
\t\t\t\tlist[i].dead = true
\t\t\tend
\t\tend
\tend
end
";

const CALL_STARTING: &str =
    "-- Runs a call-in's BOS, then starts the scripts it began, and hands back what
-- it answered.
local function callStarting(fn, ...)
\tlocal outer = woke
\twoke = false
\treturn (function(...)
\t\tstartScripts()
\t\twoke = outer
\t\treturn ...
\tend)(fn(...))
end
";

const WAIT_SLEEP: &str = "local function Sleep(ms)
\tstartScripts()
\tUnitScript.Sleep(ms)
\twoke = true
end
";

const WAITS: &str = "
-- COB runs a thread whose wait has ended two frames after the animation ends
-- (UnitScriptEngine.cpp:131-163, CobThread.cpp:838-852, CobEngine.cpp:173-189),
-- where Lua resumes it in that frame (unit_script.lua:265-280). So each wait
-- here sleeps those two frames after.
";

/// The function a `wait-for-turn`, `wait-for-move` or `wait-for-scale` calls,
/// which waits as `kind` does and then sleeps the frames COB takes to resume.
/// In a script that holds back `start-script`, it starts what the thread began
/// before it waits.
fn wait_helper(kind: &str, params: &str, defers: bool) -> String {
    let (start, woke) = if defers {
        ("\t\tstartScripts()\n", "\t\twoke = false\n")
    } else {
        ("", "")
    };
    format!(
        "local function WaitFor{kind}({params})\n\tif UnitScript.IsIn{kind}({params}) then\n{start}\t\tUnitScript.WaitFor{kind}({params})\n\t\tUnitScript.Sleep(66)\n{woke}\tend\nend\n"
    )
}

/// The names the Lua's own threads give the BOS, in the order they are
/// declared. `spawn` stands for all of them, since everything else needs it.
const SCHEDULED: &[&str] = &[
    "spawn",
    "carry",
    "Sleep",
    "WaitForTurn",
    "WaitForMove",
    "WaitForScale",
    "startScript",
    "signal",
    "setSignalMask",
];

const SCHEDULER: &str = "
-- COB runs the threads due on a frame in an order of its own: those begun with
-- start-script or back from a wait first, in the order they got there, then
-- the sleepers by when they are due and then by age (CobEngine.h:36-41,
-- CobEngine.cpp:92-105,136-200). The engine's Lua wakes them last asleep first
-- (unit_script.lua:812-836). So the BOS's threads are coroutines of the
-- script's own, and one framework thread a frame runs those due in COB's
-- order. Signals and masks are the script's own too, as the framework's only
-- reach its own threads.
";

const SCHEDULER_CORE: &str = "\tlocal threads, due, current, made = {}, {}, nil, 0
\tlocal resume
\tlocal function before(a, b)
\t\tif a.wake ~= b.wake then return a.wake < b.wake end
\t\treturn a.n < b.n
\tend
\tlocal function at(frame)
\t\tUnitScript.Sleep((frame - Spring.GetGameFrame()) * 33)
\t\tlocal list, err = due[frame] or {}, nil
\t\tdue[frame] = nil
\t\ttable.sort(list, before)
\t\tfor i = 1, #list do
\t\t\tif not list[i].over then
\t\t\t\terr = err or resume(list[i], list[i].wake > -math.huge)
\t\t\tend
\t\tend
\t\tif err then error(err, 0) end
\tend
\tlocal function queue(t, frame, wake, n)
\t\tt.frame, t.wake, t.n = frame, wake, n
\t\tif not due[frame] then
\t\t\tdue[frame] = {}
\t\t\tStartThread(at, frame)
\t\tend
\t\ttable.insert(due[frame], t)
\tend
\tlocal function ready(t, frame)
\t\tmade = made + 1
\t\tqueue(t, frame, -math.huge, made)
\tend
\t-- A script begun with start-script first runs on the next frame, or the one
\t-- after if its thread woke from a sleep to begin it (CobEngine.cpp:92-105,
\t-- 173-200), and a signal reaches it once its thread has waited or finished
\t-- (CobInstance.cpp:625,744-756).
\tlocal function finish(t, outer, ok, ...)
\t\tcurrent = outer
\t\tlocal started = t.started
\t\tt.started = nil
\t\tfor i = 1, started and #started or 0 do
\t\t\tthreads[started[i]] = true
\t\t\tready(started[i], Spring.GetGameFrame() + (t.woke and 2 or 1))
\t\tend
\t\tif coroutine.status(t.co) == \"dead\" then
\t\t\tt.over, t.ret, threads[t] = true, {...}, nil
\t\tend
\t\tif not ok then return (...) end
\tend
\tfunction resume(t, woke, ...)
\t\tlocal outer = current
\t\tcurrent, t.woke = t, woke
\t\treturn finish(t, outer, coroutine.resume(t.co, ...))
\tend
\t-- A call-in's thread, run at once until it first waits.
\tfunction spawn(fn, ...)
\t\tmade = made + 1
\t\tlocal t = {co = coroutine.create(fn), mask = 0, id = made}
\t\tlocal err = resume(t, false, ...)
\t\tif err then error(err, 0) end
\t\tif not t.over then threads[t] = true end
\t\treturn t
\tend
";

const SCHEDULER_CARRY: &str =
    "\t-- The framework reads this call-in's answer as it returns, and COB answers
\t-- once the BOS has finished (CobInstance.cpp:725-733), so it returns then.
\tfunction carry(fn, ...)
\t\tlocal t = spawn(fn, ...)
\t\twhile not t.over do
\t\t\tif t.frame then at(t.frame) else UnitScript.Sleep(33) end
\t\tend
\t\treturn unpack(t.ret or {})
\tend
";

const SCHEDULER_SLEEP: &str =
    "\t-- COB wakes a sleeper once its sleep has passed (CobEngine.cpp:148-150).
\tfunction Sleep(ms)
\t\tlocal now = Spring.GetGameFrame()
\t\tqueue(current, now + math.max(1, math.floor(ms / 33) + 1), now * 33 + ms, current.id)
\t\tcoroutine.yield()
\tend
";

const SCHEDULER_WAIT: &str =
    "\t-- COB runs a thread whose wait has ended two frames after the animation
\t-- ends, those on one animation in thread order (UnitScriptEngine.cpp:131-163,
\t-- CobInstance.cpp:526-533, CobThread.cpp:838-852). One framework thread
\t-- waits for each animation.
\tlocal waits = {}
\tlocal function wait(kind, piece, axis)
\t\tif not UnitScript[\"IsIn\" .. kind](piece, axis) then return end
\t\tlocal key = kind .. piece .. \",\" .. tostring(axis)
\t\tlocal group = waits[key]
\t\tcurrent.frame = nil
\t\tif group then
\t\t\ttable.insert(group, current)
\t\telse
\t\t\tgroup = {current}
\t\t\twaits[key] = group
\t\t\tStartThread(function()
\t\t\t\tUnitScript[\"WaitFor\" .. kind](piece, axis)
\t\t\t\twaits[key] = nil
\t\t\t\ttable.sort(group, function(a, b) return a.id < b.id end)
\t\t\t\tfor i = 1, #group do
\t\t\t\t\tif not group[i].over then ready(group[i], Spring.GetGameFrame() + 2) end
\t\t\t\tend
\t\t\tend)
\t\tend
\t\tcoroutine.yield()
\tend
";

const SCHEDULER_START: &str = "\t-- With the signal mask its thread has as it begins it (CobThread.cpp:372-388).
\tfunction startScript(fn, ...)
\t\tlocal args = {...}
\t\tmade = made + 1
\t\tlocal t = {co = coroutine.create(function() return fn(unpack(args)) end), mask = current.mask, id = made}
\t\tcurrent.started = current.started or {}
\t\ttable.insert(current.started, t)
\tend
";

const SCHEDULER_SIGNAL: &str =
    "\t-- COB's signal stops the thread that raises it too, if its mask matches, but
\t-- not a call-in on its first run (CobInstance.cpp:584-625,744-756).
\tfunction signal(mask)
\t\tfor t in pairs(threads) do
\t\t\tif math.bit_and(t.mask, mask) ~= 0 then t.over, threads[t] = true, nil end
\t\tend
\t\tif current and current.over then coroutine.yield() end
\tend
";

const SCHEDULER_MASK: &str = "\tfunction setSignalMask(mask)
\t\tif current then current.mask = mask end
\tend
";

const SHARED_VALUES: &str = include_str!("shared_values.lua");

struct Writer<'p, 'a> {
    p: &'p Program<'a>,
    mode: Mode,
    out: String,
    indent: usize,
    helpers: BTreeSet<&'static str>,
    /// Constants declared so far, by BOS name, to the Lua that names them.
    declared: HashMap<String, String>,
    const_locals: usize,
    /// Names of the current function's locals, lower-cased BOS to Lua.
    locals: HashMap<String, String>,
    /// The current function's `var`s that are set and never read, lower-cased,
    /// which are left out along with the lines that set them.
    dead: HashSet<String>,
    /// Whether anything sleeps, which the top of the file explains once.
    sleeps: bool,
    /// File-level locals the current function reads, which Lua counts.
    refs: BTreeSet<String>,
    worst_refs: usize,
    ret: Option<(Ret, Vec<String>, Vec<String>)>,
    /// Out parameters the current call-in only ever sets to a piece by name,
    /// lower-cased. Those hold Lua's number for the piece, so the answer reads
    /// `return flare` rather than a sum.
    piece_out: HashSet<String>,
    /// Whether anything reads `PIECES`.
    pieces_table: bool,
    /// Where in `out` the last `piece` line ends, which is where `PIECES` goes.
    pieces_at: Option<usize>,
    /// Something to say at the end of the line being written.
    note: Option<String>,
    warnings: Vec<Warning>,
    warned: HashSet<String>,
    include_stack: Vec<String>,
    last_header: Option<String>,
    adapters: Vec<String>,
    /// The loops the statement being written is inside, innermost last, each
    /// with the flag its `break` sets when the body is wrapped for `continue`.
    loops: Vec<Option<String>>,
    /// Whether the function being written is one the engine calls as a fire
    /// call-in, where `show` draws a muzzle flame instead of unhiding
    /// (`CobThread.cpp:715-728`).
    fire: bool,
}

impl<'p, 'a> Writer<'p, 'a> {
    const HELPER_NAMES: [&'static str; 23] = [
        PIECES,
        "COB_ANGLE",
        "COB_LINEAR",
        "trunc",
        "toCobAngle",
        "div",
        "cobAllied",
        "cobGet",
        "cobSet",
        "starting",
        "startScripts",
        "runStarted",
        "startScript",
        "callStarting",
        "WaitForScale",
        "startsHeld",
        "woke",
        "masks",
        "due",
        "signal",
        "setSignalMask",
        "spawn",
        "carry",
    ];

    fn new(p: &'p Program<'a>, mode: Mode) -> Self {
        Writer {
            p,
            mode,
            out: String::new(),
            indent: 0,
            helpers: BTreeSet::new(),
            declared: HashMap::new(),
            const_locals: 0,
            locals: HashMap::new(),
            dead: HashSet::new(),
            sleeps: false,
            refs: BTreeSet::new(),
            worst_refs: 0,
            ret: None,
            piece_out: HashSet::new(),
            pieces_table: false,
            pieces_at: None,
            note: None,
            warnings: p.warnings.clone(),
            warned: HashSet::new(),
            include_stack: Vec::new(),
            last_header: None,
            adapters: Vec::new(),
            loops: Vec::new(),
            fire: false,
        }
    }

    fn warn(&mut self, key: &str, message: String) {
        if self.warned.insert(key.to_string()) {
            self.warnings.push(Warning::unlocated(message));
        }
    }

    fn fits(&self) -> bool {
        let locals = HEADER.len()
            + self.helpers.len()
            + if self.mode.pieces_global {
                0
            } else {
                self.p.pieces.len() + usize::from(self.pieces_table)
            }
            + if self.mode.statics_global {
                0
            } else {
                self.p.statics.len()
            }
            + self.const_locals;
        locals <= MAX_LOCALS && self.worst_refs <= MAX_UPVALUES
    }

    fn finish(self) -> Conversion {
        let mut lua = format!(
            "-- {} converted from BOS by coilbox.\n",
            self.p.options.name
        );
        if self.sleeps && !self.p.scheduled {
            lua.push_str(&format!("\n-- A COB thread wakes once its sleep has passed, a frame later than Lua's\n-- Sleep wakes, so every Sleep here is {SLEEP_FRAME} milliseconds longer than the BOS's.\n"));
        }
        let mut out = self.out.clone();
        if self.pieces_table {
            let at = self.pieces_at.unwrap_or(0);
            let mut table = self.pieces_table_text();
            if !out[at..].starts_with('\n') {
                table.push('\n');
            }
            out.insert_str(at, &table);
        }
        let helpers = &self.helpers;
        if helpers.contains("COB_ANGLE") || helpers.contains("COB_LINEAR") {
            lua.push_str("\n-- BOS measures angles in 65536ths of a full turn and distances in 65536ths\n-- of an elmo. These turn its numbers into the radians and elmos Lua takes.\n");
            if helpers.contains("COB_ANGLE") {
                lua.push_str("local COB_ANGLE = math.pi / 32768\n");
            }
            if helpers.contains("COB_LINEAR") {
                lua.push_str("local COB_LINEAR = 1 / 65536\n");
            }
        }
        if helpers.contains("trunc") {
            lua.push_str("\n-- A whole number, cut toward zero, as BOS arithmetic cuts it.\nlocal function trunc(x)\n\tif x < 0 then return math.ceil(x) end\n\treturn math.floor(x)\nend\n");
        }
        if helpers.contains("toCobAngle") {
            lua.push_str("\n-- An angle a call-in was handed in radians, in the BOS's units.\nlocal function toCobAngle(radians)\n\treturn (trunc(radians / COB_ANGLE) + 32768) % 65536 - 32768\nend\n");
        }
        if helpers.contains("div") {
            lua.push_str("\n-- BOS division keeps only the whole part, and the engine answers 1000 for a\n-- division by zero.\nlocal function div(a, b)\n\tif b == 0 then return 1000 end\n\treturn trunc(a / b)\nend\n");
        }
        if helpers.contains("cobAllied") {
            lua.push_str(SHARED_VALUES);
        }
        if helpers.contains("starting") {
            lua.push_str(STARTING);
            for (name, text) in [
                ("startScript", START_SCRIPT),
                ("setSignalMask", SET_SIGNAL_MASK),
                ("signal", SIGNAL),
                ("callStarting", CALL_STARTING),
                ("Sleep", WAIT_SLEEP),
            ] {
                if helpers.contains(name) {
                    lua.push_str(text);
                }
            }
        }
        let waits = [
            ("WaitForTurn", "Turn", "piece, axis"),
            ("WaitForMove", "Move", "piece, axis"),
            ("WaitForScale", "Scale", "piece"),
        ];
        if helpers.contains("spawn") {
            let names: Vec<&str> = SCHEDULED
                .iter()
                .copied()
                .filter(|name| helpers.contains(name))
                .collect();
            lua.push_str(SCHEDULER);
            lua.push_str(&format!("local {}\ndo\n", names.join(", ")));
            lua.push_str(SCHEDULER_CORE);
            for (name, text) in [("carry", SCHEDULER_CARRY), ("Sleep", SCHEDULER_SLEEP)] {
                if helpers.contains(name) {
                    lua.push_str(text);
                }
            }
            if waits.iter().any(|(name, _, _)| helpers.contains(name)) {
                lua.push_str(SCHEDULER_WAIT);
                for (name, kind, params) in waits {
                    if helpers.contains(name) {
                        lua.push_str(&format!(
                            "\tfunction {name}({params}) wait(\"{kind}\", {params}) end\n"
                        ));
                    }
                }
            }
            for (name, text) in [
                ("startScript", SCHEDULER_START),
                ("signal", SCHEDULER_SIGNAL),
                ("setSignalMask", SCHEDULER_MASK),
            ] {
                if helpers.contains(name) {
                    lua.push_str(text);
                }
            }
            lua.push_str("end\n");
        } else if waits.iter().any(|(name, _, _)| helpers.contains(name)) {
            lua.push_str(WAITS);
            for (name, kind, params) in waits {
                if helpers.contains(name) {
                    lua.push_str(&wait_helper(kind, params, self.p.defers));
                }
            }
        }
        if (!helpers.is_empty() || self.sleeps) && !out.starts_with('\n') {
            lua.push('\n');
        }
        lua.push_str(&out);
        if !self.adapters.is_empty() {
            lua.push_str("\n-- The engine's call-ins, handed on to the functions above.\n");
            for a in &self.adapters {
                lua.push('\n');
                lua.push_str(a);
            }
        }
        while lua.ends_with("\n\n") {
            lua.pop();
        }
        Conversion {
            lua,
            warnings: self.warnings,
            shared_values: self.helpers.contains("cobAllied"),
            missing_includes: self.p.pre.missing.clone(),
        }
    }

    /// `PIECES`, naming each piece the file already holds and asking for the
    /// rest. One the model does not have is nil, as asking would stop the
    /// script loading.
    fn pieces_table_text(&self) -> String {
        let decl = if self.mode.pieces_global {
            ""
        } else {
            "local "
        };
        let mut text = format!(
            "\n-- The pieces in the order the BOS declares them. COB numbers a piece by\n-- where it is here, counted from 0.\n{decl}{PIECES} = {{\n"
        );
        for (bos, model) in &self.p.declared {
            let entry = match (self.p.pieces.iter().find(|(b, _, _)| b == bos), model) {
                (Some((_, lua, _)), _) => lua.clone(),
                (None, Some(model)) => format!("piece(\"{model}\")"),
                (None, None) => "nil".into(),
            };
            text.push_str(&format!("\t{entry},\n"));
        }
        text.push_str("}\n");
        text
    }

    // Output.

    fn line(&mut self, text: &str) {
        for _ in 0..self.indent {
            self.out.push('\t');
        }
        self.out.push_str(text);
        self.out.push('\n');
    }

    fn gap(&mut self) {
        if !self.out.is_empty() && !self.out.ends_with("\n\n") {
            self.out.push('\n');
        }
    }

    fn comment_text(c: &Comment) -> Vec<String> {
        let lines: Vec<String> = if c.block {
            c.text
                .lines()
                .map(|l| l.trim().to_string())
                .skip_while(|l| l.is_empty())
                .collect()
        } else {
            vec![c.text.trim_end().to_string()]
        };
        let mut lines = lines;
        while lines.last().is_some_and(|l| l.is_empty()) {
            lines.pop();
        }
        lines
            .into_iter()
            .map(|l| {
                if l.is_empty() {
                    "--".to_string()
                } else if c.block || l.starts_with('[') {
                    format!("-- {l}")
                } else {
                    format!("--{l}")
                }
            })
            .collect()
    }

    fn comments(&mut self, comments: &[Comment]) {
        for c in comments {
            if !self.p.visible(c.file) {
                continue;
            }
            for l in Self::comment_text(c) {
                self.line(&l);
            }
        }
    }

    /// A line of code with the comment that trailed it.
    fn code(&mut self, text: &str, trailing: &Option<Comment>) {
        if let Some(note) = self.note.take() {
            let trailing = trailing
                .as_ref()
                .filter(|c| self.p.visible(c.file))
                .map(|c| {
                    Self::comment_text(c)
                        .into_iter()
                        .map(|l| l.trim_start_matches("--").trim().to_string())
                        .collect::<Vec<_>>()
                        .join(" ")
                });
            let text = match trailing {
                Some(t) => format!("{text} -- {t}. {note}"),
                None => format!("{text} -- {note}"),
            };
            self.line(&text);
            return;
        }
        match trailing {
            Some(c) if self.p.visible(c.file) => {
                let joined = Self::comment_text(c)
                    .into_iter()
                    .map(|l| l.trim_start_matches("--").trim().to_string())
                    .collect::<Vec<_>>()
                    .join(" ");
                self.line(format!("{text} -- {joined}").trim_end());
            }
            _ => self.line(text),
        }
    }

    // Names.

    fn header(&mut self, name: &str) -> String {
        self.refs.insert(name.to_string());
        name.to_string()
    }

    fn helper(&mut self, name: &'static str) -> String {
        self.helpers.insert(name);
        if name == "toCobAngle" {
            self.helpers.insert("trunc");
            self.helpers.insert("COB_ANGLE");
        }
        if name == "div" {
            self.helpers.insert("trunc");
        }
        if name == "cobGet" || name == "cobSet" {
            self.helpers.extend(["cobAllied", "cobGet", "cobSet"]);
        }
        if self.p.scheduled && SCHEDULED.contains(&name) {
            self.helpers.insert("spawn");
        } else if STARTING_HELPERS.contains(&name) && self.p.defers {
            self.helpers.extend([
                "starting",
                "startsHeld",
                "woke",
                "masks",
                "due",
                "startScripts",
                "runStarted",
            ]);
        }
        self.refs.insert(name.to_string());
        name.to_string()
    }

    /// The function a `get` or `set` goes through: the engine's, or the Lua's
    /// own for the shared values the engine stopped keeping. An id the script
    /// only works out while running goes through the Lua's, which checks it
    /// then and hands anything else to the engine.
    fn unit_value_call(&mut self, id: Option<i64>, engine: &str, shared: &'static str) -> String {
        match id {
            Some(v) if !i32::try_from(v).is_ok_and(unitvalue::removed_shared) => {
                self.header(engine)
            }
            Some(_) => {
                self.warn(
                    "shared",
                    "This script shares unit values between units, which the engine stopped keeping in Spring 102.0. The Lua keeps them as rules params instead. Every script that shares them has to be converted too, because a COB script still reads 0. Gadgets that set them, and gadgets and widgets that read them, through Spring.SetUnitCOBValue, Spring.GetCOBTeamVar or their siblings, need lualibs/cob_vars.lua, which the BOS to Lua page offers and a model editor export writes.".to_string(),
                );
                self.helper(shared)
            }
            None => {
                self.warn(
                    "shared-runtime",
                    "A get or set here only learns which unit value it wants while running, so it goes through cobGet or cobSet, which keep the shared values the engine stopped keeping and hand any other value to the engine. If it does share values, gadgets and widgets need lualibs/cob_vars.lua to reach them.".to_string(),
                );
                self.helper(shared)
            }
        }
    }

    /// Unit values the engine dropped with nothing to stand in for them. The
    /// call stays as the BOS wrote it, and the line and the warnings say why
    /// it does nothing.
    fn removed_value(&mut self, id: Option<i64>) {
        let (name, note, message) = match id {
            Some(93) => (
                "CURRENT_FUEL",
                "CURRENT_FUEL has done nothing since Spring 101.0 removed fuel",
                "CURRENT_FUEL has done nothing since Spring 101.0 removed fuel. It reads 0 and a set is ignored, with no error in the log.",
            ),
            Some(103) => (
                "ALPHA_THRESHOLD",
                "ALPHA_THRESHOLD was removed in Spring 99.0",
                "ALPHA_THRESHOLD was removed in Spring 99.0. It reads 0, a set is ignored, and the engine logs an unknown constant error for each.",
            ),
            _ => return,
        };
        self.warn(&format!("removed:{name}"), message.to_string());
        self.note = Some(note.to_string());
    }

    fn piece(&mut self, name: &str) -> String {
        let lower = name.to_lowercase();
        match self.p.pieces.iter().find(|(bos, _, _)| *bos == lower) {
            Some((_, lua, _)) => {
                let lua = lua.clone();
                if !self.mode.pieces_global {
                    self.refs.insert(lua.clone());
                }
                lua
            }
            None => {
                self.warn(
                    &format!("piece:{lower}"),
                    format!("The script uses a piece called {name} that it never declares."),
                );
                sanitise(name, &HashSet::new())
            }
        }
    }

    fn axis(&mut self, a: Axis) -> String {
        self.header(match a {
            Axis::X => "x_axis",
            Axis::Y => "y_axis",
            Axis::Z => "z_axis",
        })
    }

    fn variable(&mut self, name: &str) -> L {
        let lower = name.to_lowercase();
        if let Some(lua) = self.locals.get(&lower) {
            return L::atom(lua.clone());
        }
        if let Some((_, lua)) = self.p.statics.iter().find(|(bos, _)| *bos == lower) {
            let lua = lua.clone();
            if !self.mode.statics_global {
                self.refs.insert(lua.clone());
            }
            return L::atom(lua);
        }
        if let Some(i) = self.p.declared.iter().position(|(bos, _)| *bos == lower) {
            // A piece as a value is COB's number for it: where the script
            // declares it, counted from zero.
            let i = i as i64;
            return L {
                text: format!("{i} --[[{name}]]"),
                ..L::number(i)
            };
        }
        if let Some(id) = self.p.cob_names.get(name) {
            let id = *id;
            self.warn(
                &format!("cob:{name}"),
                format!("{name} is never defined here, probably in an include that was not found, so the Lua uses the engine's COB.{name}."),
            );
            return L {
                value: Some(id),
                ..L::atom(format!("COB.{name}"))
            };
        }
        if let Some((_, value)) = EXPLODE_FLAGS.iter().find(|(flag, _)| *flag == name) {
            self.warn(
                &format!("flag:{name}"),
                format!("{name} is never defined here, probably in an include that was not found or is older than the one the script was compiled with, so the Lua uses {value}, its value in the standard exptype.h."),
            );
            return L::number(*value);
        }
        self.warn(
            &format!("name:{name}"),
            format!("{name} is never declared, probably in an include that was not found, so it reads as nothing and the script will stop where it is used."),
        );
        L::atom(sanitise(name, &HashSet::new()))
    }

    fn constant(&mut self, name: &str) -> L {
        let Some(c) = self.p.pre.constants.get(name) else {
            return self.variable(name);
        };
        let value = c.value;
        if self.p.cob_names.get(name) == Some(&value) {
            return L {
                value: Some(value),
                ..L::atom(format!("COB.{name}"))
            };
        }
        match self.declared.get(name) {
            Some(lua) => {
                let lua = lua.clone();
                if !self.mode.consts_global {
                    self.refs.insert(lua.clone());
                }
                L {
                    value: Some(value),
                    ..L::atom(lua)
                }
            }
            None => L::number(value),
        }
    }

    // Expressions.

    fn expr(&mut self, e: &Expr) -> L {
        match e {
            Expr::Num(v) | Expr::Angle(_, v) | Expr::Linear(_, v) => L::number(*v),
            Expr::Name(n) => self.variable(n),
            Expr::Const(n) => self.constant(n),
            Expr::Get(id, args) => {
                let id = self.num(id);
                self.removed_value(id.value);
                let f = self.unit_value_call(id.value, "GetUnitValue", "cobGet");
                let takes_piece = id.value.is_some_and(|v| {
                    ["PIECE_XZ", "PIECE_Y", "PIECE_HEADING", "PIECE_PITCH"]
                        .iter()
                        .any(|n| self.p.cob_names.get(*n) == Some(&v))
                });
                let mut parts = vec![id.text.clone()];
                for (i, a) in args.iter().enumerate() {
                    let v = if (takes_piece && i == 0) || self.piece_name(a).is_some() {
                        self.engine_piece(a)
                    } else {
                        self.num(a).text
                    };
                    parts.push(v);
                }
                L::atom(format!("{f}({})", parts.join(", ")))
            }
            Expr::Rand(a, b) => {
                let (a, b) = (self.num(a), self.num(b));
                L::atom(format!("math.random({}, {})", a.text, b.text))
            }
            Expr::Not(x) => {
                let l = self.expr(x);
                if l.literal {
                    return L::truth(l.value == Some(0));
                }
                if l.boolean {
                    L {
                        text: format!("not {}", l.wrap(P_UNARY)),
                        prec: P_UNARY,
                        boolean: true,
                        value: None,
                        literal: false,
                    }
                } else {
                    L {
                        text: format!("{} == 0", l.wrap(P_ADD)),
                        prec: P_CMP,
                        boolean: true,
                        value: None,
                        literal: false,
                    }
                }
            }
            Expr::Neg(x) => {
                let l = self.num(x);
                if l.literal {
                    return L::number(-l.value.unwrap_or(0));
                }
                L {
                    text: l.negated(),
                    prec: P_UNARY,
                    boolean: false,
                    value: l.value.map(|v| -v),
                    literal: false,
                }
            }
            Expr::Bin(op, a, b) => self.binary(op, a, b),
        }
    }

    fn binary(&mut self, op: &str, a: &Expr, b: &Expr) -> L {
        match op {
            "&&" | "||" | "^^" => {
                let (la, lb) = (self.cond(a), self.cond(b));
                let value = match (la.value, lb.value) {
                    (Some(x), Some(y)) => pp::apply(op, x, y),
                    _ => None,
                };
                if la.literal && lb.literal {
                    return L::truth(value == Some(1));
                }
                let (text, prec) = match op {
                    "&&" => (
                        format!("{} and {}", la.wrap(P_AND), lb.wrap(P_AND + 1)),
                        P_AND,
                    ),
                    "||" => (format!("{} or {}", la.wrap(P_OR), lb.wrap(P_OR + 1)), P_OR),
                    _ => (format!("{} ~= {}", la.wrap(P_ADD), lb.wrap(P_ADD)), P_CMP),
                };
                L {
                    text,
                    prec,
                    boolean: true,
                    value,
                    literal: false,
                }
            }
            _ => {
                let (la, lb) = (self.num(a), self.num(b));
                let value = match (la.value, lb.value) {
                    (Some(x), Some(y)) => pp::apply(op, x, y),
                    _ => None,
                };
                let comparison = matches!(op, "<" | ">" | "<=" | ">=" | "==" | "!=");
                if la.literal && lb.literal {
                    if let Some(v) = value {
                        return if comparison {
                            L::truth(v != 0)
                        } else {
                            L::number(v)
                        };
                    }
                }
                let infix = |text: String, prec: u8, boolean: bool| L {
                    text,
                    prec,
                    boolean,
                    value,
                    literal: false,
                };
                match op {
                    "+" | "-" => infix(
                        format!("{} {op} {}", la.wrap(P_ADD), lb.wrap(P_ADD + 1)),
                        P_ADD,
                        false,
                    ),
                    "*" => infix(
                        format!("{} * {}", la.wrap(P_MUL), lb.wrap(P_MUL + 1)),
                        P_MUL,
                        false,
                    ),
                    "/" => {
                        let f = self.helper("div");
                        infix(format!("{f}({}, {})", la.text, lb.text), P_ATOM, false)
                    }
                    "%" => infix(
                        format!("math.fmod({}, {})", la.text, lb.text),
                        P_ATOM,
                        false,
                    ),
                    "|" if la
                        .value
                        .zip(lb.value)
                        .is_some_and(|(x, y)| x & y == 0 && x >= 0 && y >= 0) =>
                    {
                        infix(
                            format!("{} + {}", la.wrap(P_ADD), lb.wrap(P_ADD + 1)),
                            P_ADD,
                            false,
                        )
                    }
                    "|" | "&" | "^" => {
                        let f = match op {
                            "|" => "bit_or",
                            "&" => "bit_and",
                            _ => "bit_xor",
                        };
                        infix(format!("math.{f}({}, {})", la.text, lb.text), P_ATOM, false)
                    }
                    _ => {
                        let lua = if op == "!=" { "~=" } else { op };
                        infix(
                            format!("{} {lua} {}", la.wrap(P_ADD), lb.wrap(P_ADD)),
                            P_CMP,
                            true,
                        )
                    }
                }
            }
        }
    }

    /// As a number, the way BOS always has it.
    fn num(&mut self, e: &Expr) -> L {
        let l = self.expr(e);
        if !l.boolean {
            return l;
        }
        match l.value {
            Some(v) if l.literal => L::number(v),
            _ => L {
                text: format!("({} and 1 or 0)", l.wrap(P_AND + 1)),
                prec: P_ATOM,
                boolean: false,
                value: l.value,
                literal: false,
            },
        }
    }

    /// As a Lua condition, where 0 must read as false.
    fn cond(&mut self, e: &Expr) -> L {
        let l = self.expr(e);
        if l.boolean {
            return l;
        }
        if l.literal {
            return L::truth(l.value != Some(0));
        }
        L {
            text: format!("{} ~= 0", l.wrap(P_ADD)),
            prec: P_CMP,
            boolean: true,
            value: l.value.map(|v| (v != 0) as i64),
            literal: false,
        }
    }

    /// A constant already in the unit the operand wants, by name. One used
    /// above where it is defined has no name yet, and is written as a number.
    fn unit_constant(&mut self, e: &Expr, negate: bool) -> Option<String> {
        let (name, minus) = bare_const(e)?;
        self.p.units.get(name)?;
        let lua = self.declared.get(name)?.clone();
        if !self.mode.consts_global {
            self.refs.insert(lua.clone());
        }
        Some(if negate != minus {
            format!("-{lua}")
        } else {
            lua
        })
    }

    /// An angle for `Turn` or `Spin`, in radians.
    fn angle(&mut self, e: &Expr, negate: bool) -> String {
        if let Some(named) = self.unit_constant(e, negate) {
            return named;
        }
        let sign = if negate { -1.0 } else { 1.0 };
        match e {
            Expr::Angle(deg, _) => return radians(sign * deg),
            Expr::Neg(inner) => {
                if let Expr::Angle(deg, _) = **inner {
                    return radians(-sign * deg);
                }
            }
            _ => {}
        }
        let l = self.num(e);
        if l.literal {
            let v = l.value.unwrap_or(0) as f64 * sign;
            let deg = v * 360.0 / 65536.0;
            if (deg * 10000.0).fract() == 0.0 {
                return radians(deg);
            }
        }
        let unit = self.helper("COB_ANGLE");
        if negate {
            format!("{} * {unit}", l.negated())
        } else {
            format!("{} * {unit}", l.wrap(P_MUL))
        }
    }

    /// Where a `Turn` goes. Near a half turn is the one place writing the
    /// degrees changes what happens. A turn goes the short way round
    /// (`TurnToward`, `UnitScript.cpp:138-151`), and BOS stores an angle a hair
    /// short of its degrees. So `<180>` and `<-180.04>` land just inside a
    /// half turn where the degrees are on it or past it, and a turn from rest
    /// would go the other way. Those keep BOS's value.
    fn turn_to(&mut self, e: &Expr, negate: bool) -> String {
        let (deg, v) = match e {
            Expr::Angle(deg, v) => (*deg, *v),
            Expr::Neg(inner) => match **inner {
                Expr::Angle(deg, v) => (-deg, -v),
                _ => return self.angle(e, negate),
            },
            _ => return self.angle(e, negate),
        };
        let (written, stored) = (
            deg.rem_euclid(360.0),
            (v as f64 * 360.0 / 65536.0).rem_euclid(360.0),
        );
        let across = (written < 180.0) != (stored < 180.0) && (written - stored).abs() < 180.0;
        if written != 180.0 && !across {
            return self.angle(e, negate);
        }
        let sign = if negate { -1.0 } else { 1.0 };
        self.note = Some(format!(
            "BOS stores <{}> as <{}>, which settles which way the piece goes",
            decimal(deg),
            decimal(v as f64 * 360.0 / 65536.0)
        ));
        format!("math.rad({})", decimal(sign * v as f64 * 360.0 / 65536.0))
    }

    /// The piece a name means, if it is one rather than a variable.
    fn piece_name(&self, e: &Expr) -> Option<String> {
        let Expr::Name(n) = e else {
            return None;
        };
        let lower = n.to_lowercase();
        let shadowed =
            self.locals.contains_key(&lower) || self.p.statics.iter().any(|(bos, _)| *bos == lower);
        (!shadowed && self.p.pieces.iter().any(|(bos, _, _)| *bos == lower)).then(|| n.clone())
    }

    /// A piece for the engine, as `piece()` numbers it, from COB's number for
    /// it. A number outside the script's pieces is 0, which the engine reads
    /// as no piece.
    fn lua_piece(&mut self, e: &Expr) -> String {
        if let Some(n) = self.piece_name(e) {
            return self.piece(&n);
        }
        let l = self.num(e);
        match l.value {
            Some(v) if l.literal => {
                let named = usize::try_from(v)
                    .ok()
                    .and_then(|i| self.p.declared.get(i))
                    .map(|(bos, _)| bos.clone());
                match named {
                    Some(bos) if self.p.pieces.iter().any(|(b, _, _)| *b == bos) => {
                        self.piece(&bos)
                    }
                    Some(_) => format!("({} or 0)", self.numbered_piece(&(v + 1).to_string())),
                    None => "0".into(),
                }
            }
            _ => format!(
                "({} or 0)",
                self.numbered_piece(&format!("{} + 1", l.wrap(P_ADD)))
            ),
        }
    }

    /// The piece at `index` in the script's own order, counted from one.
    fn numbered_piece(&mut self, index: &str) -> String {
        self.pieces_table = true;
        if !self.mode.pieces_global {
            self.refs.insert(PIECES.into());
        }
        format!("{PIECES}[{index}]")
    }

    /// A value the engine or a gadget reads as a piece, counted from zero in
    /// the model's order, which is how the engine numbers a Lua script's
    /// pieces.
    fn engine_piece(&mut self, e: &Expr) -> String {
        if let Some(n) = self.piece_name(e) {
            return format!("{} - 1", self.piece(&n));
        }
        let l = self.num(e);
        let p = self.numbered_piece(&format!("{} + 1", l.wrap(P_ADD)));
        format!("({p} or 0) - 1")
    }

    /// A distance for `Move`, in elmos.
    fn distance(&mut self, e: &Expr, negate: bool) -> String {
        if let Some(named) = self.unit_constant(e, negate) {
            return named;
        }
        let sign = if negate { -1.0 } else { 1.0 };
        match e {
            Expr::Linear(v, _) => return decimal(sign * v * self.elmos_per_bracket()),
            Expr::Neg(inner) => {
                if let Expr::Linear(v, _) = **inner {
                    return decimal(-sign * v * self.elmos_per_bracket());
                }
            }
            _ => {}
        }
        let l = self.num(e);
        if l.literal {
            let v = l.value.unwrap_or(0) as f64 * sign / 65536.0;
            if (v * 10000.0).fract() == 0.0 {
                return decimal(v);
            }
        }
        let unit = self.helper("COB_LINEAR");
        if negate {
            format!("{} * {unit}", l.negated())
        } else {
            format!("{} * {unit}", l.wrap(P_MUL))
        }
    }

    /// How many elmos `[1]` is: one for scripts compiled today, two and a half
    /// for Scriptor's, and one and a quarter for a few of Balanced
    /// Annihilation's.
    fn elmos_per_bracket(&self) -> f64 {
        self.p.options.linear_scale as f64 / 65536.0
    }

    // Top level.

    fn program(&mut self, items: &[Item]) {
        for item in items {
            match &item.kind {
                ItemKind::Comments => {
                    self.comments(&item.leading);
                }
                ItemKind::Stray { text, line } => {
                    self.comments(&item.leading);
                    self.warnings.push(Warning::at(
                        self.p.pre.files[item.file].clone(),
                        *line,
                        item.file == 0,
                        format!(
                            "`{text}` is outside any function, where the compiler drops it, so the Lua leaves it out too."
                        ),
                    ));
                }
                ItemKind::Define(name) => {
                    self.comments(&item.leading);
                    self.define(name, item.file, &item.trailing);
                }
                ItemKind::IncludeStart(name) => {
                    self.comments(&item.leading);
                    self.include_stack.push(name.clone());
                    if self.p.code_files.contains(&item.file) {
                        self.gap();
                        self.line(&format!("-- Start of {name}"));
                    }
                }
                ItemKind::IncludeEnd => {
                    self.comments(&item.leading);
                    let name = self.include_stack.pop().unwrap_or_default();
                    if self.p.code_files.contains(&item.file) {
                        self.line(&format!("-- End of {name}"));
                        self.gap();
                    }
                }
                ItemKind::Sounds => {
                    self.comments(&item.leading);
                    if let Some(c) = &item.trailing {
                        self.comments(std::slice::from_ref(c));
                    }
                }
                ItemKind::Pieces(names) => {
                    self.gap();
                    self.comments(&item.leading);
                    let mut first = true;
                    for name in names {
                        let lower = name.to_lowercase();
                        let Some((_, lua, model)) = self
                            .p
                            .pieces
                            .iter()
                            .find(|(bos, _, _)| *bos == lower)
                            .cloned()
                        else {
                            continue;
                        };
                        let decl = if self.mode.pieces_global {
                            ""
                        } else {
                            "local "
                        };
                        let trailing = if first { &item.trailing } else { &None };
                        first = false;
                        self.code(&format!("{decl}{lua} = piece(\"{model}\")"), trailing);
                    }
                    self.pieces_at = Some(self.out.len());
                }
                ItemKind::Statics(names) => {
                    self.gap();
                    self.comments(&item.leading);
                    let mut first = true;
                    for name in names {
                        let lower = name.to_lowercase();
                        let Some((_, lua)) = self
                            .p
                            .statics
                            .iter()
                            .find(|(bos, _)| *bos == lower)
                            .cloned()
                        else {
                            continue;
                        };
                        let decl = if self.mode.statics_global {
                            ""
                        } else {
                            "local "
                        };
                        let trailing = if first { &item.trailing } else { &None };
                        first = false;
                        self.code(&format!("{decl}{lua} = 0"), trailing);
                    }
                }
                ItemKind::Func(f) => {
                    let mut hoisted = Vec::new();
                    walk(&f.body, &mut |k| {
                        if let StmtKind::Define(name) = k {
                            hoisted.push(name.clone());
                        }
                    });
                    for name in hoisted {
                        self.define(&name, item.file, &None);
                    }
                    if self.p.dropped.contains(&f.name.to_lowercase()) {
                        continue;
                    }
                    self.gap();
                    self.comments(&item.leading);
                    self.func(f, &item.trailing);
                }
            }
        }
        self.special_adapters();
        self.default_piece_callins();
    }

    fn define(&mut self, name: &str, file: usize, trailing: &Option<Comment>) {
        let Some(c) = self.p.pre.constants.get(name) else {
            if let Some(t) = trailing {
                self.comments(std::slice::from_ref(t));
            }
            return;
        };
        let wanted = match &self.p.live_consts {
            Some(live) if file != 0 => live.contains(name),
            _ => self.p.visible(file) || self.p.pre.used.contains(name),
        };
        let engine = self.p.cob_names.get(name) == Some(&c.value);
        if self.declared.contains_key(name) || engine || !wanted {
            if self.p.visible(file) {
                if let Some(t) = trailing {
                    self.comments(std::slice::from_ref(t));
                }
            }
            return;
        }
        let body: Vec<_> = c
            .body
            .iter()
            .map(|t| {
                let mut t = t.clone();
                if t.kind == crate::lex::Kind::Ident && self.p.pre.constants.contains_key(&t.text) {
                    t.kind = crate::lex::Kind::Const;
                }
                t
            })
            .collect();
        let value = match (
            self.p.units.get(name),
            parse::expression(
                &body,
                self.p.options.linear_scale,
                self.p.options.precedence,
            ),
        ) {
            (Some(Unit::Angle(deg)), _) => radians(*deg),
            (Some(Unit::Linear(v)), _) => decimal(v * self.elmos_per_bracket()),
            (None, Ok(e)) => {
                let saved = std::mem::take(&mut self.refs);
                let l = self.num(&e);
                self.refs = saved;
                l.text
            }
            (None, Err(_)) => c.value.to_string(),
        };
        let lua = sanitise(name, &HashSet::new());
        let decl = if self.mode.consts_global {
            ""
        } else {
            "local "
        };
        // A header's own comments are left behind, so say where its
        // constants came from.
        if !self.p.visible(file) {
            let from = self.include_stack.last().cloned().unwrap_or_default();
            if self.last_header.as_deref() != Some(from.as_str()) {
                self.line(&format!("-- From {from}"));
                self.last_header = Some(from);
            }
        }
        // The comment is the constant's explanation, which is worth keeping
        // even when the header it came from is left out.
        let text = format!("{decl}{lua} = {value}");
        match trailing {
            Some(t) => {
                let joined = Self::comment_text(t)
                    .into_iter()
                    .map(|l| l.trim_start_matches("--").trim().to_string())
                    .collect::<Vec<_>>()
                    .join(" ");
                self.line(&format!("{text} -- {joined}"));
            }
            None => self.line(&text),
        }
        if !self.mode.consts_global {
            self.const_locals += 1;
        }
        self.declared.insert(name.to_string(), lua);
    }

    // Functions.

    fn func(&mut self, f: &Func, trailing: &Option<Comment>) {
        let info = &self.p.funcs[&f.name.to_lowercase()];
        let (lua_name, role, direct, min_args, waits, starts) = (
            info.lua.clone(),
            info.role.clone(),
            info.direct,
            info.min_args,
            info.waits,
            info.starts,
        );
        // A call-in the framework runs as a thread and reads the answer of,
        // whose BOS runs as one of the Lua's own threads.
        let carried = self.p.scheduled
            && info.blocks
            && matches!(&role, Some(Role::Callin(spec)) if spec.threaded && spec.ret != Ret::Nothing);
        self.refs.clear();
        self.locals.clear();
        self.fire =
            matches!(&role, Some(Role::Callin(spec)) if spec.lua.starts_with("script.FireWeapon"));

        // Locals may not take a name the function also needs for something else.
        let mut taken: HashSet<String> = self.p.taken.clone();
        let mut local = |bos: &str, locals: &mut HashMap<String, String>| {
            let lua = sanitise(bos, &taken);
            taken.insert(lua.clone());
            locals.insert(bos.to_lowercase(), lua.clone());
            lua
        };
        let params: Vec<String> = f
            .params
            .iter()
            .map(|n| local(n, &mut self.locals))
            .collect();
        let mut vars = Vec::new();
        walk(&f.body, &mut |k| {
            if let StmtKind::Var(names) = k {
                vars.extend(names.iter().cloned());
            }
        });
        self.dead = if self.p.options.prune {
            dead_locals(f)
        } else {
            HashSet::new()
        };
        let mut declared = Vec::new();
        for n in &vars {
            let lower = n.to_lowercase();
            if !self.locals.contains_key(&lower) && !self.dead.contains(&lower) {
                declared.push(local(n, &mut self.locals));
            }
        }
        let vars = declared;

        let mut prologue = Vec::new();
        let signature;
        self.ret = None;
        self.piece_out.clear();
        let piece_params: Vec<usize> = match &role {
            Some(Role::Callin(spec)) if direct => match spec.ret {
                Ret::Piece(i) if i < params.len() => vec![i],
                Ret::Pieces => (0..params.len()).collect(),
                _ => Vec::new(),
            },
            _ => Vec::new(),
        };
        {
            let locals = &self.locals;
            let pieces = &self.p.pieces;
            let is_piece = |n: &str| {
                let lower = n.to_lowercase();
                !locals.contains_key(&lower) && pieces.iter().any(|(bos, _, _)| *bos == lower)
            };
            for &i in &piece_params {
                if piece_only(&f.body, &f.params[i], &is_piece) {
                    self.piece_out.insert(f.params[i].to_lowercase());
                }
            }
        }
        // A call-in whose whole body names its piece hands it straight back.
        let handed_back: Option<(usize, &Stmt, &str)> = match (&role, &f.body[..]) {
            (Some(Role::Callin(spec)), [only]) if direct => match (&spec.ret, &only.kind) {
                (Ret::Piece(i), StmtKind::Assign(n, Expr::Name(piece)))
                    if f.params.get(*i).is_some_and(|p| p.eq_ignore_ascii_case(n))
                        && self.piece_out.contains(&n.to_lowercase()) =>
                {
                    Some((*i, only, piece.as_str()))
                }
                _ => None,
            },
            _ => None,
        };
        match (&role, direct) {
            (Some(Role::Callin(spec)), true) => {
                // Name each Lua argument after the BOS parameter it fills, when
                // it fills exactly one as it is or through a conversion.
                let mut args: Vec<String> = Vec::new();
                for (k, default) in spec.args.iter().enumerate() {
                    let users: Vec<usize> = spec
                        .inits
                        .iter()
                        .enumerate()
                        .filter(|(_, init)| match init {
                            Init::Arg(j, _) => *j == k,
                            Init::Expr(t) => t.contains(&format!("{{{k}}}")),
                            _ => false,
                        })
                        .map(|(i, _)| i)
                        .collect();
                    let single = users.len() == 1
                        && matches!(spec.inits[users[0]], Init::Arg(..))
                        && users[0] < params.len();
                    args.push(if single {
                        params[users[0]].clone()
                    } else {
                        let lua = sanitise(default, &taken);
                        taken.insert(lua.clone());
                        lua
                    });
                }
                // A parameter the body never names, and the answer does not
                // come from, needs no working out.
                let mut named: HashSet<String> = HashSet::new();
                if self.p.options.prune {
                    walk(&f.body, &mut |k| {
                        named.extend(target_of(k).map(str::to_lowercase));
                        for e in exprs_in(k) {
                            names_in(e, &mut named, &mut HashSet::new());
                        }
                    });
                }
                for (i, param) in params.iter().enumerate() {
                    let answers = match spec.ret {
                        Ret::Param(j)
                        | Ret::Piece(j)
                        | Ret::ParamTruthy(j)
                        | Ret::ParamWeight(j) => i == j,
                        Ret::Pieces => true,
                        Ret::Truthy | Ret::Nothing | Ret::Damage(_) => false,
                    };
                    if self.p.options.prune
                        && !answers
                        && !named.contains(&f.params[i].to_lowercase())
                    {
                        continue;
                    }
                    if handed_back.is_some_and(|(j, _, _)| i == j) {
                        continue;
                    }
                    let line = match spec.inits.get(i) {
                        Some(Init::Arg(k, template)) if args[*k] == *param => {
                            if template.is_empty() {
                                None
                            } else {
                                Some(format!(
                                    "{param} = {}",
                                    self.template(template, &args[*k..=*k])
                                ))
                            }
                        }
                        Some(Init::Arg(k, template)) => {
                            let value = if template.is_empty() {
                                args[*k].clone()
                            } else {
                                self.template(template, &args[*k..=*k])
                            };
                            Some(format!("local {param} = {value}"))
                        }
                        Some(Init::Expr(template)) => Some(format!(
                            "local {param} = {}",
                            self.template(template, &args)
                        )),
                        Some(Init::Value(v)) => Some(format!("local {param} = {v}")),
                        // A piece the script has not named yet is none, which
                        // COB writes as -1 and Lua as 0.
                        Some(Init::Zero) | None
                            if piece_params.contains(&i)
                                && !self.piece_out.contains(&f.params[i].to_lowercase()) =>
                        {
                            Some(format!("local {param} = -1"))
                        }
                        Some(Init::Zero) | None => Some(format!("local {param} = 0")),
                    };
                    prologue.extend(line);
                }
                let name = if waits || starts || carried {
                    &lua_name
                } else {
                    &spec.lua
                };
                signature = format!("function {name}({})", args.join(", "));
                self.ret = Some((spec.ret.clone(), params.clone(), args));
            }
            _ => {
                signature = format!("function {lua_name}({})", params.join(", "));
                let supplied = min_args.unwrap_or(params.len());
                for p in params.iter().skip(supplied) {
                    prologue.push(format!("{p} = {p} or 0"));
                }
            }
        }
        if !vars.is_empty() {
            prologue.push(format!(
                "local {} = {}",
                vars.join(", "),
                vec!["0"; vars.len()].join(", ")
            ));
        }

        self.line(&signature);
        self.indent += 1;
        for l in prologue {
            self.line(&l);
        }
        if let Some((_, only, piece)) = handed_back {
            self.comments(&only.leading);
            let p = self.piece(piece);
            self.code(&format!("return {p}"), &only.trailing);
        } else {
            self.block(&f.body);
        }
        self.comments(&f.tail);
        let ends_in_return = handed_back.is_some()
            || matches!(f.body.last().map(|s| &s.kind), Some(StmtKind::Return(_)));
        if !ends_in_return {
            if let Some(fallthrough) = self.fallthrough() {
                self.line(&fallthrough);
            }
        }
        self.indent -= 1;
        self.code("end", trailing);
        self.worst_refs = self.worst_refs.max(self.refs.len());
        self.ret = None;
        self.fire = false;

        if waits {
            if let Some(Role::Callin(spec)) = &role {
                self.waiting_adapter(spec, &lua_name);
            }
        } else if carried {
            if let Some(Role::Callin(spec)) = &role {
                let args = spec.args.join(", ");
                let mut all = vec![lua_name.clone()];
                all.extend(spec.args.iter().map(|a| a.to_string()));
                let call = format!("{}({})", self.helper("carry"), all.join(", "));
                self.adapters.push(format!(
                    "function {}({args})\n\treturn {call}\nend\n",
                    spec.lua
                ));
            }
        } else if direct && starts {
            if let Some(Role::Callin(spec)) = &role {
                self.starting_adapter(spec, &lua_name);
            }
        }
        if !direct {
            if let Some(Role::Callin(spec)) = &role {
                // Create with a SetMaxReloadTime beside it gets the call-in
                // that starts both, written with the other special ones.
                if !(spec.lua == "script.Create" && self.p.has_reload) {
                    self.adapter(spec, &lua_name, f.params.len());
                }
            }
        }
    }

    fn template(&mut self, template: &str, args: &[String]) -> String {
        if template.contains("toCobAngle") {
            self.helper("toCobAngle");
        }
        if template.contains("trunc") {
            self.helper("trunc");
        }
        fill(template, args)
    }

    /// `script.X` calling a BOS function that is not written as `script.X`
    /// itself, because it waits where the engine will not let it or because
    /// the script calls it too.
    fn adapter(&mut self, spec: &Spec, target: &str, params: usize) {
        let saved = std::mem::take(&mut self.refs);
        let args: Vec<String> = spec.args.iter().map(|a| a.to_string()).collect();
        let mut values = Vec::new();
        for init in spec.inits.iter().take(params) {
            values.push(match init {
                Init::Arg(k, "") => args[*k].clone(),
                Init::Arg(k, template) => self.template(template, &args[*k..=*k]),
                Init::Expr(template) => self.template(template, &args),
                Init::Value(v) => v.to_string(),
                Init::Zero => "0".into(),
            });
        }
        let blocks = self.p.funcs.values().any(|f| f.lua == target && f.blocks);
        let call = self.call_line(target, &values, blocks && !spec.threaded);
        self.adapters.push(format!(
            "function {}({})\n\t{call}\nend\n",
            spec.lua,
            args.join(", ")
        ));
        self.worst_refs = self.worst_refs.max(self.refs.len());
        self.refs = saved;
    }

    /// `script.X` for a call-in the engine wants an answer from at once, whose
    /// BOS waits. A Lua call-in may not sleep (`unit_script.lua:373`), so it
    /// runs the BOS as a thread, which starts at once, and answers what it
    /// returned if it finished before it first waited, as the engine does.
    fn waiting_adapter(&mut self, spec: &Spec, target: &str) {
        let Some(answer) = unfinished(spec) else {
            return;
        };
        let saved = std::mem::take(&mut self.refs);
        let args: Vec<String> = spec.args.iter().map(|a| a.to_string()).collect();
        let fallback = match answer {
            Unfinished::Piece(n) => match self.p.declared.get(n).cloned() {
                Some((bos, _)) if self.p.pieces.iter().any(|(b, _, _)| *b == bos) => {
                    self.piece(&bos)
                }
                Some((_, Some(model))) => format!("piece(\"{model}\")"),
                _ => "nil".into(),
            },
            Unfinished::Expr(template, _) => self.template(template, &args),
        };
        let what = match answer {
            Unfinished::Piece(n) => format!("script piece {n}"),
            Unfinished::Expr(_, what) => what.to_string(),
        };
        if self.p.scheduled {
            let mut all = vec![target.to_string()];
            all.extend(args.iter().cloned());
            let spawn = self.helper("spawn");
            self.adapters.push(format!(
                "-- {target} may wait before it finishes, and then the engine answers {what}.\nfunction {}({})\n\tlocal t = {spawn}({})\n\tif t.ret then return t.ret[1] end\n\treturn {fallback}\nend\n",
                spec.lua,
                args.join(", "),
                all.join(", ")
            ));
            self.worst_refs = self.worst_refs.max(self.refs.len());
            self.refs = saved;
            return;
        }
        let start = self.header("StartThread");
        let call = format!("{target}({})", args.join(", "));
        // A target that begins scripts starts them as from a call-in, and the
        // thread that was running, if any, carries on as it was.
        let (enter, then, leave) = if self.starts(target) {
            let woke = self.helper("woke");
            (
                format!("\tlocal outer = {woke}\n"),
                format!("\n\t\t{}()", self.helper("startScripts")),
                format!("\t{woke} = outer\n"),
            )
        } else {
            (String::new(), String::new(), String::new())
        };
        let reset = if then.is_empty() {
            String::new()
        } else {
            "\t\twoke = false\n".to_string()
        };
        self.adapters.push(format!(
            "-- {target} may wait before it finishes, and then the engine answers {what}.\nfunction {}({})\n\tlocal answer = {fallback}\n{enter}\t{start}(function()\n{reset}\t\tanswer = {call}{then}\n\tend)\n{leave}\treturn answer\nend\n",
            spec.lua,
            args.join(", ")
        ));
        self.worst_refs = self.worst_refs.max(self.refs.len());
        self.refs = saved;
    }

    /// A call-in handing on to `target`, on a thread of its own or not. A
    /// target that begins scripts starts them once it finishes, if it has not
    /// waited first.
    /// `script.X` for a call-in written straight out but for the scripts it
    /// begins, which start once it has finished, as COB starts them.
    fn starting_adapter(&mut self, spec: &Spec, target: &str) {
        let saved = std::mem::take(&mut self.refs);
        let args: Vec<String> = spec.args.iter().map(|a| a.to_string()).collect();
        let mut all = vec![target.to_string()];
        all.extend(args.iter().cloned());
        let body = if self.p.scheduled {
            // It never waits, so it has always finished.
            format!(
                "return unpack({}({}).ret)",
                self.helper("spawn"),
                all.join(", ")
            )
        } else if spec.ret == Ret::Nothing {
            format!("{}({})", self.helper("callStarting"), all.join(", "))
        } else {
            let call = format!("{}({})", self.helper("callStarting"), all.join(", "));
            format!("return {call}")
        };
        self.adapters.push(format!(
            "function {}({})\n\t{body}\nend\n",
            spec.lua,
            args.join(", ")
        ));
        self.worst_refs = self.worst_refs.max(self.refs.len());
        self.refs = saved;
    }

    fn call_line(&mut self, target: &str, values: &[String], thread: bool) -> String {
        let starts = self.starts(target);
        if self.p.scheduled {
            let blocks = self.p.funcs.values().any(|f| f.lua == target && f.blocks);
            if !blocks && !starts {
                return format!("{target}({})", values.join(", "));
            }
            let mut all = vec![target.to_string()];
            all.extend(values.iter().cloned());
            return format!("{}({})", self.helper("spawn"), all.join(", "));
        }
        if thread {
            let start = self.header("StartThread");
            let mut all = vec![target.to_string()];
            if starts {
                // A call-in's thread has no signal mask.
                all.splice(0..0, [self.helper("runStarted"), "0".to_string()]);
            }
            all.extend(values.iter().cloned());
            format!("{start}({})", all.join(", "))
        } else if starts {
            let call = self.helper("callStarting");
            let mut all = vec![target.to_string()];
            all.extend(values.iter().cloned());
            format!("{call}({})", all.join(", "))
        } else {
            format!("{target}({})", values.join(", "))
        }
    }

    /// `start-script`, which COB runs once the thread that began it waits or
    /// finishes (`CobThread.cpp:372-388`), where `StartThread` runs it at once.
    fn start_line(&mut self, target: &str, values: &[String]) -> String {
        let start = self.helper("startScript");
        let mut all = vec![target.to_string()];
        all.extend(values.iter().cloned());
        format!("{start}({})", all.join(", "))
    }

    /// A call that may wait. When a script begun with `start-script` may be
    /// held back, this is the Lua's own, which starts it first.
    fn waiting(&mut self, name: &'static str) -> String {
        if self.p.defers || self.p.scheduled {
            self.helper(name)
        } else {
            self.header(name)
        }
    }

    /// Whether the function written as `lua` begins scripts.
    fn starts(&self, lua: &str) -> bool {
        self.p.funcs.values().any(|f| f.lua == lua && f.starts)
    }

    /// The call-ins made of more than one BOS function, or of one the engine
    /// calls under another name.
    fn special_adapters(&mut self) {
        let mut by_role: HashMap<String, (String, bool)> = HashMap::new();
        let mut create = None;
        for name in &self.p.func_order {
            let info = &self.p.funcs[name];
            match &info.role {
                Some(Role::Special(s)) => {
                    by_role.insert(format!("{s:?}"), (info.lua.clone(), info.blocks));
                }
                Some(Role::Callin(s)) if s.lua == "script.Create" && !info.direct => {
                    create = Some((info.lua.clone(), info.blocks));
                }
                _ => {}
            }
        }
        let saved = std::mem::take(&mut self.refs);

        let rates: Vec<(u8, String, bool)> = (0..4)
            .filter_map(|n| {
                by_role
                    .get(&format!("{:?}", Special::MoveRate(n)))
                    .map(|(lua, b)| (n, lua.clone(), *b))
            })
            .collect();
        if !rates.is_empty() {
            let mut text = "function script.MoveRate(rate)\n".to_string();
            for (i, (n, lua, blocks)) in rates.iter().enumerate() {
                let call = self.call_line(lua, &[], *blocks);
                let word = if i == 0 { "if" } else { "elseif" };
                text.push_str(&format!("\t{word} rate == {n} then\n\t\t{call}\n"));
            }
            text.push_str("\tend\nend\n");
            self.adapters.push(text);
        }

        let speed = by_role.get(&format!("{:?}", Special::SetSpeed)).cloned();
        let direction = by_role
            .get(&format!("{:?}", Special::SetDirection))
            .cloned();
        if speed.is_some() || direction.is_some() {
            let mut text = "function script.WindChanged(heading, strength)\n".to_string();
            if let Some((lua, blocks)) = &speed {
                let v = self.template("trunc({} * 3000)", &["strength".to_string()]);
                text.push_str(&format!("\t{}\n", self.call_line(lua, &[v], *blocks)));
            }
            if let Some((lua, blocks)) = &direction {
                let v = self.template("toCobAngle({})", &["heading".to_string()]);
                text.push_str(&format!("\t{}\n", self.call_line(lua, &[v], *blocks)));
            }
            text.push_str("end\n");
            self.adapters.push(text);
        }
        if let Some((lua, blocks)) = &speed {
            let mut text = "function script.ExtractionRateChanged(rate)\n".to_string();
            let v = self.template("trunc({} * 500)", &["rate".to_string()]);
            text.push_str(&format!("\t{}\n", self.call_line(lua, &[v], *blocks)));
            if let Some(go) = self.p.funcs.get("go") {
                let call = self.call_line(&go.lua.clone(), &[], go.blocks);
                let id = self.header("unitID");
                text.push_str(&format!(
                    "\t-- The engine starts Go as well when the extractor is switched on.\n\tif Spring.GetUnitIsActive({id}) then\n\t\t{call}\n\tend\n"
                ));
            }
            text.push_str("end\n");
            self.adapters.push(text);
        }

        let reload = by_role
            .get(&format!("{:?}", Special::SetMaxReloadTime))
            .cloned();
        if let Some((reload, blocks)) = reload {
            let mut text = "function script.Create()\n".to_string();
            // The engine runs Create and then SetMaxReloadTime before any
            // script Create began (`CobInstance.cpp:231-232`), so those are
            // held back until both have run.
            let hold =
                !self.p.scheduled && create.as_ref().is_some_and(|(lua, _)| self.starts(lua));
            if let Some((lua, _)) = &create {
                let call = self.call_line(lua, &[], true);
                if hold {
                    let held = self.helper("startsHeld");
                    text.push_str(&format!(
                        "\t-- The engine runs SetMaxReloadTime before anything Create starts.\n\t{held} = true\n\t{call}\n\t{held} = false\n"
                    ));
                } else {
                    text.push_str(&format!("\t{call}\n"));
                }
            }
            let id = self.header("unitID");
            // Its own thread, as the engine runs it for a COB script: started
            // after Create, so it runs after whatever Create does before its
            // first wait, and a default Create sets is then overridden.
            let _ = blocks;
            let call = self.call_line(
                &reload,
                &[format!(
                    "math.floor(Spring.UnitScript.GetLongestReloadTime({id}))"
                )],
                true,
            );
            text.push_str(&format!(
                "\t-- The engine tells a COB script its longest reload once it is created, and\n\t-- does not tell a Lua one, so this asks.\n\t{call}\n"
            ));
            if hold {
                text.push_str(&format!("\t{}()\n", self.helper("startScripts")));
            }
            text.push_str("end\n");
            self.adapters.push(text);
        }
        self.worst_refs = self.worst_refs.max(self.refs.len());
        self.refs = saved;
    }

    /// The piece call-ins the BOS leaves out, written to answer what the engine
    /// answers a COB script for them. The engine seeds the answer with 1 and
    /// returns it when the function is missing (`CobInstance.cpp:411-420,
    /// 437-446`), where a Lua script answers no piece (`LuaUnitScript.cpp:
    /// 505-509`). Script piece 1 is the second declared piece, and a script
    /// that declares only one has no such piece, so the engine sprays and
    /// fires from nothing and there is nothing to write.
    fn default_piece_callins(&mut self) {
        if self.p.declared.len() < 2 {
            return;
        }
        let have = |p: &Program, key: &str| {
            p.func_order.iter().any(|n| {
                let info = &p.funcs[n];
                !p.dropped.contains(n)
                    && matches!(&info.role, Some(Role::Callin(s)) if s.lua == key)
            })
        };
        let mut missing = Vec::new();
        if !have(self.p, "script.QueryNanoPiece") {
            missing.push("QueryNanoPiece".to_string());
        }
        let mut weapons = std::collections::BTreeSet::new();
        for n in &self.p.func_order {
            if self.p.dropped.contains(n) {
                continue;
            }
            let Some(Role::Callin(s)) = &self.p.funcs[n].role else {
                continue;
            };
            let Some(rest) = s.lua.strip_prefix("script.") else {
                continue;
            };
            let digits = rest.trim_start_matches(|c: char| !c.is_ascii_digit());
            let stem = &rest[..rest.len() - digits.len()];
            if let Ok(number) = digits.parse::<u32>() {
                if WEAPON_STEMS.contains(&stem) {
                    weapons.insert(number);
                }
            }
        }
        for n in weapons {
            for stem in ["QueryWeapon", "AimFromWeapon"] {
                if !have(self.p, &format!("script.{stem}{n}")) {
                    missing.push(format!("{stem}{n}"));
                }
            }
        }
        if missing.is_empty() {
            return;
        }
        // The piece by name where the script keeps it, so a pruned script does
        // not gain a table of every piece it declared.
        let (second, model) = self.p.declared[1].clone();
        let saved = std::mem::take(&mut self.refs);
        let answer = if self.p.pieces.iter().any(|(b, _, _)| *b == second) {
            self.piece(&second)
        } else if let Some(model) = model {
            format!("piece(\"{model}\")")
        } else {
            self.refs = saved;
            return;
        };
        for name in missing {
            self.adapters.push(format!(
                "-- The engine answers script piece 1 for a COB script with no {name}.\nfunction script.{name}()\n\treturn {answer}\nend\n"
            ));
        }
        self.worst_refs = self.worst_refs.max(self.refs.len());
        self.refs = saved;
    }

    fn fallthrough(&mut self) -> Option<String> {
        let (ret, params, _) = self.ret.clone()?;
        let param = |i: usize| params.get(i).cloned().unwrap_or_else(|| "0".into());
        let piece = |i: usize, this: &mut Self| {
            let p = param(i);
            let typed = this
                .locals
                .iter()
                .any(|(bos, lua)| *lua == p && this.piece_out.contains(bos));
            if typed || p == "0" {
                p
            } else {
                this.numbered_piece(&format!("{p} + 1"))
            }
        };
        Some(match ret {
            Ret::Param(i) => format!("return {}", param(i)),
            Ret::Piece(i) if i >= params.len() => return None,
            Ret::Piece(i) => format!("return {}", piece(i, self)),
            Ret::Pieces => format!(
                "return {{{}}}",
                (0..params.len())
                    .map(|i| piece(i, self))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            Ret::ParamTruthy(i) => format!("return {} ~= 0", param(i)),
            Ret::ParamWeight(i) => format!("return {} / 65536", param(i)),
            Ret::Damage(_) => "return 0".into(),
            Ret::Truthy | Ret::Nothing => return None,
        })
    }

    fn return_text(&mut self, value: &Option<Expr>) -> String {
        let Some((ret, params, args)) = self.ret.clone() else {
            return match value {
                Some(e) => format!("return {}", self.num(e).text),
                None => "return".into(),
            };
        };
        match (&ret, value) {
            (Ret::Truthy, Some(e)) => format!("return {}", self.cond(e).text),
            (Ret::Truthy, None) => "return false".into(),
            (Ret::Damage(k), Some(e)) => {
                let pct = self.num(e);
                format!("return {} * {} / 100", args[*k], pct.wrap(P_MUL + 1))
            }
            (Ret::Nothing, _) => "return".into(),
            _ => {
                let _ = &params;
                self.fallthrough().unwrap_or_else(|| "return".into())
            }
        }
    }

    // Statements.

    fn block(&mut self, stmts: &[Stmt]) {
        for (i, s) in stmts.iter().enumerate() {
            self.stmt(s, i + 1 == stmts.len());
        }
    }

    fn stmt(&mut self, s: &Stmt, last: bool) {
        self.comments(&s.leading);
        let t = &s.trailing;
        match &s.kind {
            StmtKind::Assign(name, _) | StmtKind::Inc(name) | StmtKind::Dec(name)
                if self.dead.contains(&name.to_lowercase()) =>
            {
                if let Some(c) = t {
                    self.comments(std::slice::from_ref(c));
                }
            }
            StmtKind::Assign(name, e) => {
                let target = self.variable(name).text;
                let v = match e {
                    Expr::Name(n) if self.piece_out.contains(&name.to_lowercase()) => self.piece(n),
                    _ => self.num(e).text,
                };
                self.code(&format!("{target} = {v}"), t);
            }
            StmtKind::Inc(name) | StmtKind::Dec(name) => {
                let target = self.variable(name).text;
                let op = if matches!(s.kind, StmtKind::Inc(_)) {
                    "+"
                } else {
                    "-"
                };
                self.code(&format!("{target} = {target} {op} 1"), t);
            }
            StmtKind::If {
                cond,
                then,
                then_tail,
                els,
            } => {
                let c = self.cond(cond).text;
                self.code(&format!("if {c} then"), &None);
                self.if_rest(then, then_tail, els);
                self.code("end", t);
            }
            StmtKind::While { cond, body, tail } => {
                let c = self.cond(cond).text;
                self.code(&format!("while {c} do"), &None);
                self.loop_body(body, tail, None);
                self.code("end", t);
            }
            // A `while` with the step after the body is the loop exactly, with
            // `continue` leaving the body and so still running the step. A Lua
            // numeric `for` is not: it reads its limit once and ignores a body
            // that changes the counter.
            StmtKind::For {
                init,
                cond,
                step,
                body,
                tail,
            } => {
                if let Some(init) = init {
                    self.stmt(init, false);
                }
                let c = match cond {
                    Some(cond) => self.cond(cond).text,
                    None => "true".into(),
                };
                self.code(&format!("while {c} do"), &None);
                self.loop_body(body, tail, step.as_deref());
                self.code("end", t);
            }
            StmtKind::Block(body, tail) => {
                self.line("do");
                self.indent += 1;
                self.block(body);
                self.comments(tail);
                self.indent -= 1;
                self.code("end", t);
            }
            // The engine hands `call-script lua_X` to LuaRules' global `X`,
            // whatever the script defines under that name. A unit script cannot
            // reach LuaRules' globals, only `GG`.
            StmtKind::Call(name, args) if name.starts_with("lua_") => {
                // A gadget reads a piece as the engine numbers it.
                let values: Vec<String> = args
                    .iter()
                    .map(|a| match self.piece_name(a) {
                        Some(_) => self.engine_piece(a),
                        None => self.num(a).text,
                    })
                    .collect();
                let lua = &name["lua_".len()..];
                self.warn(
                    &format!("luacall:{name}"),
                    format!("call-script {name} runs LuaRules' own {lua} in the engine, which a Lua unit script cannot reach, so the Lua calls GG.{lua} if a gadget puts it there. Anything it hands back through LUA0 to LUA9 is lost."),
                );
                let id = self.header("unitID");
                let def = self.header("unitDefID");
                let call = std::iter::once(format!("{id}, {def}, Spring.GetUnitTeam({id})"))
                    .chain(values)
                    .collect::<Vec<_>>()
                    .join(", ");
                self.code(&format!("if GG.{lua} then GG.{lua}({call}) end"), t);
            }
            StmtKind::Call(name, args) | StmtKind::Start(name, args) => {
                let start = matches!(s.kind, StmtKind::Start(..));
                let mut values: Vec<String> = args.iter().map(|a| self.num(a).text).collect();
                let target = self.callee(name);
                // The engine moves a started script's arguments by popping
                // them off the caller and pushing them onto the new thread,
                // which reverses them (`CobThread.cpp:225`). A call leaves
                // them where they are.
                let reversed = start && values.len() > 1;
                if reversed {
                    self.warn(
                        "start-reversed",
                        "The engine hands a script begun with start-script its arguments in reverse order, so the Lua passes them reversed too and behaves as the compiled script does. Total Annihilation passed them in the order written, so a script that was written for it and never corrected has had them swapped ever since.".to_string(),
                    );
                }
                if reversed && args.iter().filter(|a| !pure(a)).count() > 1 {
                    // Worked out in the order written, as the COB pushes them,
                    // and only then handed over backwards.
                    let mut names: Vec<String> =
                        (1..=values.len()).map(|n| format!("arg{n}")).collect();
                    self.line("do");
                    self.indent += 1;
                    self.line(&format!(
                        "local {} = {}",
                        names.join(", "),
                        values.join(", ")
                    ));
                    names.reverse();
                    let text = self.start_line(&target, &names);
                    self.line(&text);
                    self.indent -= 1;
                    self.code("end", t);
                } else {
                    if reversed {
                        values.reverse();
                    }
                    let text = if start {
                        self.start_line(&target, &values)
                    } else {
                        format!("{target}({})", values.join(", "))
                    };
                    self.code(&text, t);
                }
            }
            StmtKind::Spin {
                piece,
                axis,
                speed,
                accel,
            } => {
                let f = self.header("Spin");
                let p = self.piece(piece);
                let a = self.axis(*axis);
                let sp = self.angle(speed, *axis == Axis::Z);
                let text = match accel {
                    Some(acc) => format!("{f}({p}, {a}, {sp}, {})", self.angle(acc, false)),
                    None => format!("{f}({p}, {a}, {sp})"),
                };
                self.code(&text, t);
            }
            StmtKind::StopSpin { piece, axis, decel } => {
                let f = self.header("StopSpin");
                let p = self.piece(piece);
                let a = self.axis(*axis);
                let text = match decel {
                    Some(d) => format!("{f}({p}, {a}, {})", self.angle(d, false)),
                    None => format!("{f}({p}, {a})"),
                };
                self.code(&text, t);
            }
            StmtKind::Turn {
                piece,
                axis,
                dest,
                speed,
            } => {
                let f = self.header("Turn");
                let p = self.piece(piece);
                let a = self.axis(*axis);
                let d = self.turn_to(dest, *axis == Axis::Z);
                let text = match speed {
                    Some(sp) => format!("{f}({p}, {a}, {d}, {})", self.angle(sp, false)),
                    None => format!("{f}({p}, {a}, {d})"),
                };
                self.code(&text, t);
            }
            StmtKind::Move {
                piece,
                axis,
                dest,
                speed,
            } => {
                let f = self.header("Move");
                let p = self.piece(piece);
                let a = self.axis(*axis);
                let d = self.distance(dest, *axis == Axis::X);
                let text = match speed {
                    Some(sp) => format!("{f}({p}, {a}, {d}, {})", self.distance(sp, false)),
                    None => format!("{f}({p}, {a}, {d})"),
                };
                self.code(&text, t);
            }
            StmtKind::Scale { piece, dest, speed } => {
                let f = self.header("Scale");
                let p = self.piece(piece);
                let d = self.distance(dest, false);
                let text = match speed {
                    Some(sp) => format!("{f}({p}, {d}, {})", self.distance(sp, false)),
                    None => format!("{f}({p}, {d})"),
                };
                self.code(&text, t);
            }
            StmtKind::WaitScale(piece) => {
                let f = self.helper("WaitForScale");
                let p = self.piece(piece);
                self.code(&format!("{f}({p})"), t);
            }
            StmtKind::Break => {
                let text = if last { "break" } else { "do break end" };
                match self.loops.last().cloned().flatten() {
                    Some(flag) => {
                        self.line(&format!("{flag} = true"));
                        self.code(text, t);
                    }
                    None => self.code(text, t),
                }
            }
            // Only in a body `loop_body` wrapped, where leaving the `repeat`
            // goes on to the next time round.
            StmtKind::Continue => {
                self.code(if last { "break" } else { "do break end" }, t);
            }
            StmtKind::MissionCommand(args) => {
                for a in args {
                    self.num(a);
                }
                self.warn(
                    "mission-command",
                    "Mission-Command is an opcode from Total Annihilation: Kingdoms that the engine does not run. A COB thread reaching it logs an error and stops, so the Lua raises one there.".into(),
                );
                let text = "error(\"Mission-Command is not something the engine runs\")";
                if last {
                    self.code(text, t);
                } else {
                    self.code(&format!("do {text} end"), t);
                }
            }
            StmtKind::WaitTurn(piece, axis) | StmtKind::WaitMove(piece, axis) => {
                let name = if matches!(s.kind, StmtKind::WaitTurn(..)) {
                    "WaitForTurn"
                } else {
                    "WaitForMove"
                };
                let f = self.helper(name);
                let p = self.piece(piece);
                let a = self.axis(*axis);
                self.code(&format!("{f}({p}, {a})"), t);
            }
            StmtKind::EmitSfx(kind, piece) => {
                let f = self.header("EmitSfx");
                let p = self.piece(piece);
                let k = self.num(kind).text;
                self.code(&format!("{f}({p}, {k})"), t);
            }
            StmtKind::Sleep(e) => {
                self.sleeps = true;
                let f = self.waiting("Sleep");
                if self.p.scheduled {
                    let v = self.num(e).text;
                    self.code(&format!("{f}({v})"), t);
                } else {
                    let v = self.num(e).wrap(P_ADD);
                    self.code(&format!("{f}({v} + {SLEEP_FRAME})"), t);
                }
            }
            StmtKind::Show(piece) if self.fire => {
                let p = self.piece(piece);
                self.code(&format!("Spring.UnitScript.ShowFlare({p})"), t);
            }
            StmtKind::Hide(piece) | StmtKind::Show(piece) => {
                let f = self.header(if matches!(s.kind, StmtKind::Hide(_)) {
                    "Hide"
                } else {
                    "Show"
                });
                let p = self.piece(piece);
                self.code(&format!("{f}({p})"), t);
            }
            StmtKind::Explode(piece, flags) => {
                let f = self.header("Explode");
                let p = self.piece(piece);
                let v = self.num(flags).text;
                self.code(&format!("{f}({p}, {v})"), t);
            }
            StmtKind::Signal(e) | StmtKind::SetSignalMask(e) => {
                let signal = matches!(s.kind, StmtKind::Signal(_));
                let f = match (self.p.defers || self.p.scheduled, signal) {
                    (true, true) => self.helper("signal"),
                    (true, false) => self.helper("setSignalMask"),
                    (false, true) => self.header("Signal"),
                    (false, false) => self.header("SetSignalMask"),
                };
                let v = self.num(e).text;
                self.code(&format!("{f}({v})"), t);
            }
            StmtKind::Set(id, value) => {
                let id = self.num(id);
                self.removed_value(id.value);
                let f = self.unit_value_call(id.value, "SetUnitValue", "cobSet");
                let v = self.num(value).text;
                self.code(&format!("{f}({}, {v})", id.text), t);
            }
            StmtKind::Get(e) => {
                let v = self.expr(e).text;
                if v.ends_with(')') {
                    self.code(&v, t);
                } else {
                    self.code(&format!("local _ = {v}"), t);
                }
            }
            StmtKind::AttachUnit(unit, piece) => {
                let u = self.num(unit).text;
                let p = self.lua_piece(piece);
                self.code(&format!("Spring.UnitScript.AttachUnit({p}, {u})"), t);
            }
            StmtKind::DropUnit(unit) => {
                let u = self.num(unit).text;
                self.code(&format!("Spring.UnitScript.DropUnit({u})"), t);
            }
            StmtKind::Return(value) => {
                let text = self.return_text(value);
                if last {
                    self.code(&text, t);
                } else {
                    self.code(&format!("do {text} end"), t);
                }
            }
            StmtKind::PlaySound(name, volume) => {
                let v = self.num(volume).text;
                self.warn(
                    &format!("sound:{name}"),
                    format!("play-sound has no exact Lua equivalent, so {name} is played with Spring.PlaySoundFile at the unit, which may not be the file the COB played."),
                );
                let id = self.header("unitID");
                self.code(
                    &format!("Spring.PlaySoundFile(\"sounds/{name}.wav\", {v} / 65536, Spring.GetUnitPosition({id}))"),
                    t,
                );
            }
            StmtKind::Var(_) | StmtKind::Ignored | StmtKind::Define(_) | StmtKind::Empty => {
                if let Some(c) = t {
                    self.comments(std::slice::from_ref(c));
                }
            }
        }
    }

    /// A loop's body, then its step if it is a `for`.
    ///
    /// Lua 5.1 has no `continue`, so a body that uses one goes inside
    /// `repeat ... until true`, where `break` leaves the body and the loop goes
    /// round again. A real `break` in there sets a flag first, which ends the
    /// loop once the `repeat` is left.
    fn loop_body(&mut self, body: &[Stmt], tail: &[Comment], step: Option<&Stmt>) {
        self.indent += 1;
        let flag = continues(body).then(|| {
            let taken: HashSet<String> = self
                .p
                .taken
                .iter()
                .chain(self.locals.values())
                .cloned()
                .collect();
            sanitise("broke", &taken)
        });
        if let Some(flag) = &flag {
            self.line(&format!("local {flag} = false"));
            self.line("repeat");
            self.indent += 1;
        }
        self.loops.push(flag.clone());
        if step.is_some() && flag.is_none() {
            // Nothing in the body is last, because the step follows it.
            for s in body {
                self.stmt(s, false);
            }
        } else {
            self.block(body);
        }
        self.comments(tail);
        self.loops.pop();
        if let Some(flag) = &flag {
            self.indent -= 1;
            self.line("until true");
            self.line(&format!("if {flag} then break end"));
        }
        if let Some(step) = step {
            self.stmt(step, false);
        }
        self.indent -= 1;
    }

    fn if_rest(
        &mut self,
        then: &[Stmt],
        then_tail: &[Comment],
        els: &Option<(Vec<Stmt>, Vec<Comment>)>,
    ) {
        self.indent += 1;
        self.block(then);
        self.comments(then_tail);
        self.indent -= 1;
        let Some((els, tail)) = els else { return };
        // `else if` in BOS is `elseif` in Lua, when nothing else sits between.
        if let [only] = els.as_slice() {
            if let StmtKind::If {
                cond,
                then,
                then_tail,
                els,
            } = &only.kind
            {
                if only.leading.is_empty() && only.trailing.is_none() && tail.is_empty() {
                    let c = self.cond(cond).text;
                    self.code(&format!("elseif {c} then"), &None);
                    self.if_rest(then, then_tail, els);
                    return;
                }
            }
        }
        self.line("else");
        self.indent += 1;
        self.block(els);
        self.comments(tail);
        self.indent -= 1;
    }

    fn callee(&mut self, name: &str) -> String {
        match self.p.funcs.get(&name.to_lowercase()) {
            Some(info) => match &info.role {
                Some(Role::Callin(spec)) if info.direct && !info.waits && !info.starts => {
                    spec.lua.clone()
                }
                _ => info.lua.clone(),
            },
            None => {
                self.warn(
                    &format!("func:{name}"),
                    format!("The script calls {name}, which it never defines."),
                );
                sanitise(name, &HashSet::new())
            }
        }
    }
}

fn decimal(v: f64) -> String {
    if v == 0.0 {
        return "0".into();
    }
    let text = format!("{v:.4}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    // A speed of 0 moves a piece at once in Lua (`LuaUnitScript.cpp:1627-1633`)
    // where a slow one creeps, so a small number keeps all its digits.
    if text == "0" || text == "-0" {
        return format!("{v}");
    }
    text.to_string()
}

fn radians(deg: f64) -> String {
    if deg == 0.0 {
        "0".into()
    } else {
        format!("math.rad({})", decimal(deg))
    }
}
