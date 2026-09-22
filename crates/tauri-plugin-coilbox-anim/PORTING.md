# BOS ↔ COB — Rust porting spec

A faithful, **byte-exact** Rust port of `beyond-all-reason/BARScriptCompiler`
(`bos2cob_py3.py` compiler, `cob_file.py` container, `cob_decompiler.py`
disassembler). Line refs are to `bos2cob_py3.py` unless noted.

## Golden test harness (reference oracle)

The Python reference is the oracle. To (re)generate fixtures:

```
# in a venv with pcpp installed (pip install pcpp)
python bos2cob_py3.py path/to/foo.bos          # -> foo.cob (default mode, fold on, v4)
python bos2cob_py3.py --dontfold foo.bos       # skip constant folding
python cob_decompiler.py foo.cob               # disassembly listing + opcode/arg stats
```

**Pinned reference: `9a2a84d`** (2026-09-18, "Readd --gltf-swap and update exe
to 1.3"), the parity commit this port is checked against. The checked-out
reference has no `--nopcpp` flag any more. Upstream removed the old
preprocessor in `c4ab7be`, so its only mode runs pcpp, a full C preprocessor,
ahead of its own `preprocess()`.

**Parity target: the reference's default mode (pcpp).** The checked-out
reference has dropped `--nopcpp` and always runs pcpp, a full C preprocessor,
ahead of its own `preprocess()`. `preprocess.rs` now covers what pcpp adds
over the original builtin preprocessor: function-like macros (`#define
NAME(a,b) body`, with `\` line continuations, nested calls, and
parenthesis-aware argument splitting) and `#if`/`#elif` over integer constant
expressions plus `defined(X)`/`defined X`. Object-like macros, `#ifdef`,
`#include`, and the nested-tuple token quirks below are unchanged from the
original port and stay byte-identical, guarded by the `min`, `features`,
`folds`, and `anims` golden tests plus `preprocess.rs`'s own unit tests
(`handles_defines_conditionals_and_macro_expansion`,
`passes_through_plain_source_unchanged`).

The tokenizer drops whitespace, so `#define NAME(a,b)` (function-like) and
`#define NAME (a,b)` (object-like, body `(a,b)`, as carrier.bos's own `#define
MUZZLE (1028 + get PERK_BETTER_KINETICS)` does) are indistinguishable once
tokenized. `defines_as_function_like` in `preprocess.rs` settles it with a
direct scan of the raw source for that one `#define`, rather than the token
stream.

**Scriptor's file-scope allowance.** Scriptor accepted a bare assignment
outside any function. A `.cob` only holds functions, so it emitted nothing for
it. The grammar's `_strayDeclaration` rule (`grammar.rs`) accepts `name =
expr;` at file scope. `compiler.rs` needs no special case, because the bytes
land in the scratch buffer the next `funcDec` resets, so it compiles away on
its own. `parser::stray_warnings` reports it instead of staying silent.

## Pipeline

`text → preprocess() (macros incl. function-like, #if/#elif, #ifdef, #include)
→ tokenizer → Pump → parse(_file) → fold (single post-order pass) → Compiler → COB bytes`

- Args: `--shortopcodes` (opcode table swap, cobVersion 8 else 4), `--dontfold`.
  Constants: `LINEAR_SCALE=65536`, `ANGULAR_SCALE=182`.
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

## Constant folding, `fold.rs`, ported from upstream's "Rewrite constant
folding" and "Add compile-time-constant folding to emit-sfx" (both after this
port's original cutoff, see "Pinned reference" below)

- Single post-order pass, no fixpoint loop. Children fold before their parent,
  so a nested paren or a chain of operators resolves in one walk.
- `constant_value(node)` = `int(scale * float(node.get_text()))`, scale 65536
  for `[X]`, 182 for `<X>`, else 1. Works the same whether the node is a raw
  parse (`signedFloatConstant`/`signedIntegerConstant`) or an already-folded
  `integerConstant` leaf, since it only ever reads `get_text()`.
- `term_constant_value(term)` treats a piece name as a compile-time constant
  too, its index in the piece list, from `collect_piece_names` run once over
  the whole tree before folding starts. `base + 1` folds like a literal would.
- `fold_expression` scans every possible island start position, extends it
  while the next operator is one of `+ - * / % & | ^` and its operand is a
  constant, then folds the whole run at once with a small shunting-yard
  (`evaluate_island`) that respects real operator precedence, so `2 + 1 * 2`
  folds to `4`, not `6`. `island_starts_safe`/`island_ends_safe` refuse a
  start or end that would change which operand an outside operator binds to.
  An unsafe start, the operator right before the island binds tighter than
  the island's own first operator, unless it is the exact same associative
  operator repeated. An unsafe end, the island's own last operator binds
  looser than the operator right after it.
- Every folded value is a plain 32-bit integer. `/` truncates toward zero and
  `%` takes the sign of the left operand (C semantics, not Python's floored
  division/mod). A fold that would divide or mod by zero, or push any
  intermediate or final value outside `i32` range, is skipped, leaving the
  runtime opcode in place rather than erroring.
- Parenthesis collapse: `term = ( expression )` with a single
  compile-time-constant term collapses straight to that term's child.
- emit-sfx's `from` clause is a full expression now, not just a bare piece
  name. `Compiler::get_emit_sfx_piece` resolves it to a piece index after
  folding runs, either a bare piece name, or an already-folded constant in
  range. Anything else (a runtime variable, an out-of-range or negative
  index) is a compile error, not a silent fallback.
- A piece name can no longer double as a static-var or local-var name
  (checked once, in `parse_file`, after the whole tree has been walked, so
  declaration order does not matter). Bundled into the same upstream commit
  as the emit-sfx change because both guard the same assumption, that a piece
  name used as a variable always means the piece.

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
- constant L1036: `PUSH_CONSTANT` then 4 bytes. 1 child: `value=int(float(text))`
  (truncate toward zero, matches Rust `as i64`), `<0`→signed pack.
  3 children `[`: `int(65536*float)` (truncate toward 0), `<`: `int(182*float)`.
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

## Byte-exactness hazards

1. plain and bracket constants both use `int()` truncation toward zero. No
   divergence between them any more (both were already `int()` on the bracket
   side, the fold rewrite moved the plain side off `round()` to match).
2. RETURN appended only if not already trailing.
3. keywordStatement double-reversal (children reversed, int args reversed again).
4. emit-sfx: `from` expression resolved to a piece index at compile time
   (see "Constant folding" above), then `EMIT_SFX` + piece idx. explode:
   expr pushed + `EXPLODE` + piece idx.
5. signal/set-signal-mask: expr pushed + opcode (no implicit shift).
6. start/call-script operand order = [func_index, arg_count], verified against
   a golden .cob (`START_SCRIPT [func_index, arg_count]`).
7. all code is 4-byte words, no padding inside code.
8. `#if`/`#elif` are handled by `preprocess.rs` directly now (see
   "Parity target" above), evaluating an integer constant expression with C
   precedence over macros and `defined(X)`/`defined X`. A branch that is
   never taken is never evaluated, so a malformed condition inside dead code
   is not an error.

## Status

Compiler (`anim_bos2cob`) implemented and byte-exact vs the reference across the
golden fixtures in `tests/`: `min`, `features` (broad keyword/jump/operator
coverage), `folds` (truncation/bracket/bitwise/precedence hazards), and `anims`
(remaining animation keywords). These four also guard that function-like
macros and `#if`/`#elif` left the pre-existing object-macro/`#ifdef`/`#include`
behaviour byte-identical, since none of them exercise the new code paths.
`tests/fold.rs` ports upstream's `test_constant_folding.py` cases plus the
emit-sfx and piece-name-uniqueness cases from "Add compile-time-constant
folding to emit-sfx", each checked against bytes the pinned reference
produces for the same snippet. `cargo test -p tauri-plugin-coilbox-anim`.

Out of scope: `--gltf-swap`/`--gltf-swap-s3o` and the `#define GLTF` custom
axis-spec syntax (`dd01436`, `da1fb14`, `482e919`). This port has no
`--gltf-swap` flag at all, and upstream itself deprecated then re-added the
feature across these commits, so there is nothing here for it to extend.

## cob_decompiler.py (disassembler, NOT a BOS regenerator)

Reads header, pieces, scripts; lists per-script opcode + raw args. Its `cmd +=
str(op)` is a char-splitting quirk; our Rust disasm emits a clean listing
(opcode mnemonic + decimal args). Use it as a round-trip sanity oracle, not for
byte parity.
