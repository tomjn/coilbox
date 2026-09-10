//! The Lua.
//!
//! Every value keeps the meaning it had in the BOS: a whole number, in 65536ths
//! of a turn for an angle and of an elmo for a distance, where zero is false.
//! Conversion happens only where a number meets the engine. A `turn` becomes a
//! `Turn` in radians, a call-in the engine hands radians gets them back in the
//! BOS's units, and a condition tests `~= 0` rather than trusting Lua, where 0
//! is true.
//!
//! Pieces are the one exception. A piece in Lua is the number `piece()` hands
//! out, counted from one, and the Lua holds that number everywhere a BOS script
//! held the piece, so a query call-in returns it as it is. The few unit values
//! that take a piece get it counted from zero, as the engine wants.

use crate::parse::{self, Axis, Comment, Expr, Func, Item, ItemKind, Stmt, StmtKind};
use crate::pp::{self, Output as Pre};
use crate::{Conversion, Options};
use coilbox_unitpose::unitvalue::NAMES as COB_NAMES;
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
    result.warnings.push(format!(
        "Even with its pieces, variables and constants made global, a function here uses more than Lua's {MAX_UPVALUES} outside names, so the engine will refuse to load it."
    ));
    Ok(result)
}

/// What is known about the script before a line of Lua is written.
struct Program<'a> {
    pre: &'a Pre,
    options: &'a Options<'a>,
    /// Lower-cased BOS name to (Lua name, the name `piece()` is asked for).
    pieces: Vec<(String, String, String)>,
    statics: Vec<(String, String)>,
    funcs: HashMap<String, FuncInfo>,
    /// BOS function names in the order they are defined.
    func_order: Vec<String>,
    /// Files that hold code rather than only `#define`s.
    code_files: HashSet<usize>,
    /// Constants the engine's own `COB` table already names, with the same value.
    cob_names: HashMap<String, i64>,
    taken: HashSet<String>,
    warnings: Vec<String>,
    /// Whether the script has a SetMaxReloadTime, whose call-in shares
    /// `script.Create` with Create itself.
    has_reload: bool,
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
fn exprs_in(k: &StmtKind) -> Vec<&Expr> {
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
        | StmtKind::While { cond: e, .. } => vec![e],
        StmtKind::Set(a, b) | StmtKind::AttachUnit(a, b) => vec![a, b],
        StmtKind::Call(_, args) | StmtKind::Start(_, args) => args.iter().collect(),
        StmtKind::Return(Some(e)) => vec![e],
        StmtKind::Spin { speed, accel, .. } => std::iter::once(speed).chain(accel).collect(),
        StmtKind::StopSpin { decel, .. } => decel.iter().collect(),
        StmtKind::Turn { dest, speed, .. } | StmtKind::Move { dest, speed, .. } => {
            std::iter::once(dest).chain(speed).collect()
        }
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
            _ => {}
        }
    }
}

impl<'a> Program<'a> {
    fn new(items: &'a [Item], pre: &'a Pre, options: &'a Options<'a>) -> Self {
        let mut p = Program {
            pre,
            options,
            pieces: Vec::new(),
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
        };
        let mut seen: HashSet<String> = HashSet::new();
        let mut funcs: Vec<&Func> = Vec::new();
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
                                        p.warnings.push(format!(
                                        "The script names a piece called {name} that the model does not have, so the engine will refuse to load it."
                                    ));
                                        name.clone()
                                    }
                                }
                            }
                            None => name.clone(),
                        };
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
                    funcs.push(f);
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
        let names: HashSet<&str> = funcs.iter().map(|f| f.name.as_str()).collect();
        let mut claimed: HashMap<String, String> = HashMap::new();
        for f in &funcs {
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
                    p.warnings.push(format!(
                        "{keep} and {drop} are the same call-in. The engine calls {keep} and {drop} becomes an ordinary function."
                    ));
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
                },
            );
        }
        if (1..=32).any(|n| claimed.contains_key(&format!("script.QueryWeapon{n}")))
            && !claimed.contains_key("script.AimWeapon1")
        {
            p.warnings.push(
                "The unit script framework only hands weapon call-ins on when AimWeapon1 exists, and this script has none, so its weapons will not aim.".into(),
            );
        }

        // Who calls whom, and with how many arguments.
        let mut blocks_directly: HashMap<String, bool> = HashMap::new();
        let mut calls: HashMap<String, Vec<String>> = HashMap::new();
        for f in &funcs {
            let lower = f.name.to_lowercase();
            let mut blocks = false;
            let mut callees = Vec::new();
            walk(&f.body, &mut |k| match k {
                StmtKind::Sleep(_) | StmtKind::WaitTurn(..) | StmtKind::WaitMove(..) => {
                    blocks = true
                }
                StmtKind::Call(name, args) | StmtKind::Start(name, args) => {
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
            calls.insert(lower, callees);
        }
        let mut blocking: HashSet<String> = blocks_directly
            .iter()
            .filter(|(_, b)| **b)
            .map(|(n, _)| n.clone())
            .collect();
        loop {
            let before = blocking.len();
            for (name, callees) in &calls {
                if callees.iter().any(|c| blocking.contains(c)) {
                    blocking.insert(name.clone());
                }
            }
            if blocking.len() == before {
                break;
            }
        }
        let has_reload = p
            .funcs
            .values()
            .any(|f| matches!(f.role, Some(Role::Special(Special::SetMaxReloadTime))));
        p.has_reload = has_reload;
        for (name, info) in p.funcs.iter_mut() {
            info.blocks = blocking.contains(name);
            info.direct = match &info.role {
                Some(Role::Callin(s)) if s.ret != Ret::Nothing => {
                    if info.called {
                        p.warnings.push(format!(
                            "The script calls {} itself. The Lua calls the engine's {} instead, which gets the same answer.",
                            info.lua, s.lua
                        ));
                    }
                    true
                }
                Some(Role::Callin(s)) if s.lua == "script.Create" && has_reload => false,
                Some(Role::Callin(s)) => !info.called && (s.threaded || !info.blocks),
                _ => false,
            };
            if let Some(Role::Callin(s)) = &info.role {
                if s.ret != Ret::Nothing && info.blocks && !s.threaded {
                    p.warnings.push(format!(
                        "{} waits, but the engine wants its answer at once, so it will stop with an error the first time it waits.",
                        info.lua
                    ));
                }
            }
        }
        p
    }

    fn visible(&self, file: usize) -> bool {
        file == 0 || self.code_files.contains(&file)
    }
}

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
    /// File-level locals the current function reads, which Lua counts.
    refs: BTreeSet<String>,
    worst_refs: usize,
    ret: Option<(Ret, Vec<String>, Vec<String>)>,
    /// Out parameters the current call-in only ever sets to a piece by name,
    /// lower-cased. Those hold Lua's number for the piece, so the answer reads
    /// `return flare` rather than a sum.
    piece_out: HashSet<String>,
    /// Something to say at the end of the line being written.
    note: Option<String>,
    warnings: Vec<String>,
    warned: HashSet<String>,
    include_stack: Vec<String>,
    last_header: Option<String>,
    adapters: Vec<String>,
}

impl<'p, 'a> Writer<'p, 'a> {
    const HELPER_NAMES: [&'static str; 6] = [
        "COB_ANGLE",
        "COB_LINEAR",
        "trunc",
        "toCobAngle",
        "div",
        "BosSleep",
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
            refs: BTreeSet::new(),
            worst_refs: 0,
            ret: None,
            piece_out: HashSet::new(),
            note: None,
            warnings: p.warnings.clone(),
            warned: HashSet::new(),
            include_stack: Vec::new(),
            last_header: None,
            adapters: Vec::new(),
        }
    }

    fn warn(&mut self, key: &str, message: String) {
        if self.warned.insert(key.to_string()) {
            self.warnings.push(message);
        }
    }

    fn fits(&self) -> bool {
        let locals = HEADER.len()
            + self.helpers.len()
            + if self.mode.pieces_global {
                0
            } else {
                self.p.pieces.len()
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
        if helpers.contains("BosSleep") {
            lua.push_str("\n-- A COB thread wakes once its sleep has passed, a frame later than Lua's\n-- Sleep wakes, so this adds the frame back and keeps the BOS's timing.\nlocal function BosSleep(ms)\n\tSleep(ms + 33)\nend\n");
        }
        if helpers.contains("div") {
            lua.push_str("\n-- BOS division keeps only the whole part, and the engine answers 1000 for a\n-- division by zero.\nlocal function div(a, b)\n\tif b == 0 then return 1000 end\n\treturn trunc(a / b)\nend\n");
        }
        if !helpers.is_empty() && !self.out.starts_with('\n') {
            lua.push('\n');
        }
        lua.push_str(&self.out);
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
        }
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
        self.refs.insert(name.to_string());
        name.to_string()
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
        if self.p.pieces.iter().any(|(bos, _, _)| *bos == lower) {
            // A piece as a value is COB's number for it, counted from zero, so
            // a script using `base` as nought still means nought.
            let p = self.piece(name);
            return L {
                text: format!("{p} - 1"),
                prec: P_ADD,
                boolean: false,
                value: None,
                literal: false,
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
                let mut parts = vec![id.text.clone()];
                for a in args {
                    parts.push(self.num(a).text);
                }
                let f = self.header("GetUnitValue");
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
                    text: format!("-{}", l.wrap(P_UNARY)),
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

    /// An angle for `Turn` or `Spin`, in radians.
    fn angle(&mut self, e: &Expr, negate: bool) -> String {
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
            format!("-{} * {unit}", l.wrap(P_UNARY))
        } else {
            format!("{} * {unit}", l.wrap(P_MUL))
        }
    }

    /// Where a `Turn` goes. An exact half turn is the one place writing the
    /// degrees changes what happens: BOS stores `<180>` as a hair under a half
    /// turn, which fixes the way the piece goes, and an exact half turn is a
    /// tie the engine may settle the other way. So that one keeps BOS's value.
    fn turn_to(&mut self, e: &Expr, negate: bool) -> String {
        let (deg, v) = match e {
            Expr::Angle(deg, v) => (*deg, *v),
            Expr::Neg(inner) => match **inner {
                Expr::Angle(deg, v) => (-deg, -v),
                _ => return self.angle(e, negate),
            },
            _ => return self.angle(e, negate),
        };
        if deg.rem_euclid(360.0) != 180.0 {
            return self.angle(e, negate);
        }
        let sign = if negate { -1.0 } else { 1.0 };
        self.note = Some(format!(
            "BOS stores <{}> a hair under a half turn, which settles which way the piece goes",
            decimal(deg)
        ));
        format!("math.rad({})", decimal(sign * v as f64 * 360.0 / 65536.0))
    }

    /// A piece for the engine, counted from one, from a value counted from
    /// zero.
    fn lua_piece(&mut self, e: &Expr) -> String {
        if let Expr::Name(n) = e {
            let lower = n.to_lowercase();
            let shadowed = self.locals.contains_key(&lower)
                || self.p.statics.iter().any(|(bos, _)| *bos == lower);
            if !shadowed && self.p.pieces.iter().any(|(bos, _, _)| *bos == lower) {
                return self.piece(n);
            }
        }
        let l = self.num(e);
        match l.value {
            Some(v) if l.literal => (v + 1).to_string(),
            _ => format!("{} + 1", l.wrap(P_ADD)),
        }
    }

    /// A distance for `Move`, in elmos.
    fn distance(&mut self, e: &Expr, negate: bool) -> String {
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
            format!("-{} * {unit}", l.wrap(P_UNARY))
        } else {
            format!("{} * {unit}", l.wrap(P_MUL))
        }
    }

    /// How many elmos `[1]` is: one for scripts compiled today, two and a half
    /// for Scriptor's.
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
                ItemKind::Pieces(names) => {
                    self.gap();
                    self.comments(&item.leading);
                    for (i, name) in names.iter().enumerate() {
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
                        let trailing = if i == 0 { &item.trailing } else { &None };
                        self.code(&format!("{decl}{lua} = piece(\"{model}\")"), trailing);
                    }
                }
                ItemKind::Statics(names) => {
                    self.gap();
                    self.comments(&item.leading);
                    for (i, name) in names.iter().enumerate() {
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
                        let trailing = if i == 0 { &item.trailing } else { &None };
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
                    self.gap();
                    self.comments(&item.leading);
                    self.func(f, &item.trailing);
                }
            }
        }
        self.special_adapters();
    }

    fn define(&mut self, name: &str, file: usize, trailing: &Option<Comment>) {
        let Some(c) = self.p.pre.constants.get(name) else {
            if let Some(t) = trailing {
                self.comments(std::slice::from_ref(t));
            }
            return;
        };
        let wanted = self.p.visible(file) || self.p.pre.used.contains(name);
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
        let value = match parse::expression(&body, self.p.options.linear_scale) {
            Ok(e) => {
                let saved = std::mem::take(&mut self.refs);
                let l = self.num(&e);
                self.refs = saved;
                l.text
            }
            Err(_) => c.value.to_string(),
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
        let (lua_name, role, direct, min_args) = (
            info.lua.clone(),
            info.role.clone(),
            info.direct,
            info.min_args,
        );
        self.refs.clear();
        self.locals.clear();

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
        let mut declared = Vec::new();
        for n in &vars {
            if !self.locals.contains_key(&n.to_lowercase()) {
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
                for (i, param) in params.iter().enumerate() {
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
                signature = format!("function {}({})", spec.lua, args.join(", "));
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
        self.block(&f.body);
        self.comments(&f.tail);
        let ends_in_return = matches!(f.body.last().map(|s| &s.kind), Some(StmtKind::Return(_)));
        if !ends_in_return {
            if let Some(fallthrough) = self.fallthrough() {
                self.line(&fallthrough);
            }
        }
        self.indent -= 1;
        self.code("end", trailing);
        self.worst_refs = self.worst_refs.max(self.refs.len());
        self.ret = None;

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

    fn call_line(&mut self, target: &str, values: &[String], thread: bool) -> String {
        if thread {
            let start = self.header("StartThread");
            let mut all = vec![target.to_string()];
            all.extend(values.iter().cloned());
            format!("{start}({})", all.join(", "))
        } else {
            format!("{target}({})", values.join(", "))
        }
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
            if let Some((lua, _)) = &create {
                let start = self.header("StartThread");
                text.push_str(&format!("\t{start}({lua})\n"));
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
                "\t-- The engine tells a COB script its longest reload once it is created, and\n\t-- does not tell a Lua one, so this asks.\n\t{call}\nend\n"
            ));
            self.adapters.push(text);
        }
        self.worst_refs = self.worst_refs.max(self.refs.len());
        self.refs = saved;
    }

    fn fallthrough(&mut self) -> Option<String> {
        let (ret, params, _) = self.ret.clone()?;
        let param = |i: usize| params.get(i).cloned().unwrap_or_else(|| "0".into());
        let piece = |i: usize, this: &Self| {
            let p = param(i);
            let typed = this
                .locals
                .iter()
                .any(|(bos, lua)| *lua == p && this.piece_out.contains(bos));
            if typed || p == "0" {
                p
            } else {
                format!("{p} + 1")
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
                self.line(&format!("if {c} then"));
                self.if_rest(then, then_tail, els);
                self.code("end", t);
            }
            StmtKind::While { cond, body, tail } => {
                let c = self.cond(cond).text;
                self.line(&format!("while {c} do"));
                self.indent += 1;
                self.block(body);
                self.comments(tail);
                self.indent -= 1;
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
            StmtKind::Call(name, args) | StmtKind::Start(name, args) => {
                let start = matches!(s.kind, StmtKind::Start(..));
                let values: Vec<String> = args.iter().map(|a| self.num(a).text).collect();
                let target = self.callee(name);
                let text = self.call_line(&target, &values, start);
                self.code(&text, t);
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
            StmtKind::WaitTurn(piece, axis) | StmtKind::WaitMove(piece, axis) => {
                let f = self.header(if matches!(s.kind, StmtKind::WaitTurn(..)) {
                    "WaitForTurn"
                } else {
                    "WaitForMove"
                });
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
                self.helpers.insert("BosSleep");
                let f = self.helper("BosSleep");
                let v = self.num(e).text;
                self.code(&format!("{f}({v})"), t);
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
                let f = self.header(if matches!(s.kind, StmtKind::Signal(_)) {
                    "Signal"
                } else {
                    "SetSignalMask"
                });
                let v = self.num(e).text;
                self.code(&format!("{f}({v})"), t);
            }
            StmtKind::Set(id, value) => {
                let f = self.header("SetUnitValue");
                let id = self.num(id).text;
                let v = self.num(value).text;
                self.code(&format!("{f}({id}, {v})"), t);
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
                    self.line(&format!("elseif {c} then"));
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
                Some(Role::Callin(spec)) if info.direct => spec.lua.clone(),
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
    text.to_string()
}

fn radians(deg: f64) -> String {
    if deg == 0.0 {
        "0".into()
    } else {
        format!("math.rad({})", decimal(deg))
    }
}
