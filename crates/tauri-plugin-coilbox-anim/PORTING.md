# BOS ↔ COB — Rust porting spec

A faithful, **byte-exact** Rust port of `beyond-all-reason/BARScriptCompiler`
(`bos2cob_py3.py` compiler, `cob_file.py` container, `cob_decompiler.py`
disassembler). Line refs are to `bos2cob_py3.py` unless noted.

## Golden test harness (reference oracle)

The Python reference is the oracle. To (re)generate fixtures:

```
# in a venv with pcpp installed (pip install pcpp)
python bos2cob_py3.py path/to/foo.bos          # -> foo.cob (default: pcpp + builtin preproc, fold on, v4)
python bos2cob_py3.py --nopcpp foo.bos         # builtin preprocessor only (our parity target)
python bos2cob_py3.py --dontfold foo.bos       # skip constant folding
python cob_decompiler.py foo.cob               # disassembly listing + opcode/arg stats
```

**Parity target: `--nopcpp` (builtin preprocessor only).** Matching full pcpp
(a complete C preprocessor) is out of scope; our preprocessor ports the builtin
`preprocess()` only. For scripts using only simple `#define`/`#ifdef`/`#include`
the two modes produce identical `.cob`.

## Pipeline

`text → [pcpp (skipped)] → builtin preprocess() → tokenizer → Pump → parse(_file)
→ fold (fixpoint) → Compiler → COB bytes`

- Args: `--shortopcodes` (opcode table swap, cobVersion 8 else 4), `--dontfold`,
  `--nopcpp`. Constants: `LINEAR_SCALE=65536`, `ANGULAR_SCALE=182`.
- Output file: `<basename>.cob`.

## Opcodes (§ `opcodes.rs`)

Standard table L34-106 (32-bit values). Short table L108-195 (cobVersion 8).
**Every opcode value is packed `<L` = 4 bytes regardless of mode** (L200-201);
operands are always 4-byte words too. Key values: `MOVE`=0x10001000,
`TURN`=0x10002000, `SPIN`=0x10003000, `STOP_SPIN`=0x10004000, `SHOW`=0x10005000,
`HIDE`=0x10006000, `EMIT_SFX`=0x1000F000, `WAIT_FOR_TURN`=0x10011000,
`WAIT_FOR_MOVE`=0x10012000, `SLEEP`=0x10013000, `PUSH_CONSTANT`=0x10021001,
`PUSH_LOCAL_VAR`=0x10021002, `PUSH_STATIC`=0x10021004, `CREATE_LOCAL_VAR`=0x10022000,
`POP_LOCAL_VAR`=0x10023002, `POP_STATIC`=0x10023004, `POP_STACK`=0x10024000,
`ADD`=0x10031000, `SUB`=0x10032000, `MUL`=0x10033000, `DIV`=0x10034000,
`MOD`=0x10034001, `BITWISE_AND/OR/XOR/NOT`=0x10035000..38000, `RAND`=0x10041000,
`GET_UNIT_VALUE`=0x10042000, `GET`=0x10043000, comparisons `SET_LESS`=0x10051000..
`LOGICAL_NOT`=0x1005A000, `START_SCRIPT`=0x10061000, `CALL_SCRIPT`=0x10062000,
`JUMP`=0x10064000, `RETURN`=0x10065000, `JUMP_NOT_EQUAL`=0x10066000,
`SIGNAL`=0x10067000, `SET_SIGNAL_MASK`=0x10068000, `EXPLODE`=0x10071000,
`PLAY_SOUND`=0x10072000, `SET`=0x10082000, `ATTACH_UNIT`=0x10083000,
`DROP_UNIT`=0x10084000. `DONT_SHADE`==`DONT_SHADOW`==0x1000E000.
`OPS` operator→opcode L217-241. `OPS_PRECEDENCE` L256-281 (lower = higher prec):
`* / %`=1; `+ -`=2; `< > <= >=`=3; `== !=`=4; `&`=5; `^`=6; `|`=7; `&& AND`=8;
`|| OR`=9; `^^ XOR`=10. `UNARY_OPS`: `! NOT`→`LOGICAL_NOT`. `AXES=(x,y,z)` → 0,1,2.
`index()` lookups are **case-insensitive** (L210-215). `get_num`=pack `<L`
(unsigned), `get_signed_num`=pack `<l` (signed).

## Tokenizer — `token_generator` L1198-1314

Yields `(token, idx)`. Delimiter set L1199: `{ } [ ] ( ) space & | ^ + - * / % , ; < > = ! # tab cr lf \`.
Strings: `"` toggles; emits full quoted span incl. quotes. `//` line comment,
`/* */` block comment. `#` → emit literal `#`, preprocessor mode to `\n` (unless
`\` line-continuation → emits `$` marker; `//` in a directive also emits `$`).
Delimiters split the accumulated token (`.strip().strip('\\')`) then emit the
delimiter char if non-blank (whitespace emits nothing). Multi-char operators are
emitted as separate chars and reassembled by grammar rule `_op`.

## Parser — §3

`Node{_type,_text,_children}`. `get_text()` returns `_text` or, if None,
**concatenation of children's text** (load-bearing for multi-token names/axes).
`Pump` flattens tokens, `next()`/`update(rewind)` for backtracking.
`parse(pump,node,block_type)` L1144-1187 + `try_parse` L1189. Atoms L567-572
(int/float/string/identifier, L502-554; int accepts `0x..` hex). Terminals
L556-565 (keyword/symbol sets, case-insensitive). Rules `PARSER_DICT` L574-690:
tuple of alternatives; child suffix `~`=zero-or-more, `?`=optional; first match
wins, else `clear()`+backtrack. Grammar/node types: see L574-690 (file,
pieceDec, staticVarDec, funcDec, statement/keywordStatement and all animation
statements, axis, expression/term/op/constant/get/rand).

## Constant folding — `fold_node` L361-469 (post-order, fixpoint via main loop)

- Negative collapse: `signedFloatConstant [-,X]` → `'-'+X.text`.
- Bracket scaling on `constant` w/ 3 children: `[X]`→`X.text=str(float(X)*65536)`,
  `<X>`→`*182`; pops the bracket symbols.
- Arithmetic (`expression` ≥2 children): precedence `% * / + - | & ^`
  (`OPS_PYEVAL_PRECEDENCE` L254); evaluate adjacent constant pairs via Python
  `eval`. **Division yielding `abs(result)<1` with nonzero numerator is SKIPPED**
  (L425-427). `& | ^` map to `&& || ^^` for eval.
- Parenthesis collapse: `term=( expr )` with single foldable constant → inner.
- Quirk: `return foldcount` is INSIDE the while loop (L469) → at most one
  iteration per call; main loops to fixpoint. Replicate.

## Codegen — `Compiler` L699-1097, §6

State: `_static_vars/_local_vars/_pieces/_functions` (index = append order),
`_code` (current fn bytes), `_total_offset` (words), `_functions_code` dict.
`current_offset()=_total_offset + len(_code)//4` (absolute word offset).

- `parse_file`: pre-register all funcDec names (forward refs), then parse.
- `parse_funcDec` L806-825: clear locals, `_code=b""`; compile args (one
  `CREATE_LOCAL_VAR` each); compile body; if body empty reset `_code=b""`;
  **append RETURN if last 4 bytes ≠ RETURN**: `PUSH_CONSTANT + get_num(0) + RETURN`;
  `_total_offset += len/4`; store.
- assign: compile RHS expr, then POP into var. inc/dec: PUSH var,PUSH_CONSTANT 1,
  ADD/SUB, POP var.
- `keywordStatement` L880-949: rebuild hyphenated keyword from `-` joiners;
  children in **declared order for `set`/`attach-unit`, else reversed**; collect
  int args (piece idx, func idx, axis 0/1/2, expressionList count) and emit
  expression code inline; `speedNow`→`-now` suffix selects `*_NOW`; `optional*`
  empty→`PUSH_CONSTANT 0`. Emit: `opcode + pack('<%dL', *args[::-1])` (int args
  reversed again → net declared order). attach-unit appends dummy `PUSH_CONSTANT 0`.
- get L952: compile child exprs; 1 expr→`GET_UNIT_VALUE` else `GET`. rand→`RAND`.
- if L979: cond; `JUMP_NOT_EQUAL`+placeholder(0); then-block; if else `JUMP`+ph;
  patch ph with `get_num(current_offset())` (ABSOLUTE WORD offset, byte-splice).
- while L1015: `start=current_offset()`; cond; JNE+ph; body; `JUMP get_num(start)`;
  patch JNE ph to exit offset.
- for: **no codegen** (unsupported).
- expression L998: shunting-yard, pop while top precedence ≤ current (left-assoc),
  emit `OPS[op]`. term L1027: unaryOp postfix; varName→`get_variable(push=True)`.
- constant L1036: `PUSH_CONSTANT` then 4 bytes. 1 child: `value=round(float(text))`
  (**Python banker's rounding, ties-to-even** — NOT f64::round); `<0`→signed pack.
  3 children `[`: `int(65536*float)` (truncate toward 0); `<`: `int(182*float)`.
- `get_variable(name,push)` L1081: search [local,static,(pieces if push)] in order,
  case-insensitive, first match → `opcode + get_num(index)`.

## COB container — `cob_file.COB` L23-97, §8

Final layout (all `<L` LE): `[header 44B][all fn code, in function_names order]
[code-offset array (words)][script-name-offset array][piece-name-offset array]
[fn name strings NUL-term][piece name strings NUL-term]`. Header fields in
`COB_HEADER_FIELDS` order: VersionSignature, NumberOfScripts, NumberOfPieces,
TotalScriptLen (code words), NumberOfStaticVars, Unknown_2=0,
OffsetToScriptCodeIndexArray, OffsetToScriptNameOffsetArray,
OffsetToPieceNameOffsetArray, OffsetToScriptCode(=44), OffsetToNamesArray.
Name strings byte-packed (no alignment). Sounds list unused.

## Byte-exactness hazards (§7)

1. plain constant uses **ties-to-even** `round()`; bracket uses `int()` truncation.
2. division-skip-when-`abs<1` changes which folds happen.
3. `--dontfold` `[x]`/`<x>` uses `int()` (truncation) vs folded `round()` → can differ.
4. RETURN appended only if not already trailing.
5. keywordStatement double-reversal (children reversed, int args reversed again).
6. emit-sfx: `expr` pushed + `EMIT_SFX` + piece idx. explode: expr + `EXPLODE` + piece idx.
7. signal/set-signal-mask: expr pushed + opcode (no implicit shift).
8. start/call-script operand order = [func_index, arg_count] — **verified** against
   a golden .cob (`START_SCRIPT [func_index, arg_count]`).
9. all code is 4-byte words; no padding inside code.
10. **Fold left-operand quirk:** `term_is_a_signedFloatConstant()` returns a
    `floatConstant` Node whose `__len__()==0`, so it is *falsy*. The fold branch
    that would let `term1` come from an `opterm`'s right term ANDs in that falsy
    node and never fires — so a fold's left operand can ONLY be the expression's
    first child. Net: `y + 1 * 2` folds nothing; `1 * 2 + y` folds `1*2`. The
    Rust port replicates this (only `children[i]` as a bare `term` is `term1`).
11. **`#if` is unsupported** in `--nopcpp`: the reference's `#if` does
    `"".join()` over `(token, idx)` tuples and crashes (`TypeError`). The port
    errors on `#if` rather than inventing behaviour.

## Status

Compiler (`anim_bos2cob`) implemented and byte-exact vs the reference across the
golden fixtures in `tests/`: `min`, `features` (broad keyword/jump/operator
coverage), `folds` (rounding/division-skip/bracket/bitwise hazards), and `anims`
(remaining animation keywords). `cargo test -p tauri-plugin-coilbox-anim`.

## cob_decompiler.py (disassembler, NOT a BOS regenerator)

Reads header, pieces, scripts; lists per-script opcode + raw args. Its `cmd +=
str(op)` is a char-splitting quirk; our Rust disasm emits a clean listing
(opcode mnemonic + decimal args). Use it as a round-trip sanity oracle, not for
byte parity.
