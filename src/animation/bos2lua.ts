/**
 * BOS → Lua unit-script converter.
 *
 * A faithful TypeScript port of CarRepairer's `bos2lua` PHP converter
 * (ZeroK-RTS/SpringRTS-Tools, bos2lua/index.php). Like the original it is a
 * best-effort sequence of textual transforms, NOT a real compiler — it gets you
 * most of the way from a `.bos` script to a Lua unit script, but the output will
 * need hand-fixing. The pipeline and each transform mirror the PHP one-for-one.
 *
 * PHP → JS mapping: `str_replace(array,array,subject)` becomes literal,
 * sequential `split/join`; `preg_replace` becomes a global RegExp; `\1` style
 * backreferences become `$1`.
 */

/** Literal, sequential replacement — matches PHP `str_replace` with arrays. */
function strReplace(subject: string, find: string[], rep: string[]): string {
  let out = subject;
  for (let i = 0; i < find.length; i++) {
    out = out.split(find[i]).join(rep[i]);
  }
  return out;
}

/** Apply each [pattern, replacement] globally, in order (PHP `preg_replace`). */
function pregReplace(
  subject: string,
  rules: ReadonlyArray<readonly [RegExp, string]>,
): string {
  let out = subject;
  for (const [re, rep] of rules) out = out.replace(re, rep);
  return out;
}

function convertPieces(bos: string): string {
  let out = "";
  const re = /piece ([^;]*);/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = re.exec(bos)) !== null) {
    for (const raw of m[1].split(",")) {
      const piece = raw.trim();
      out += `local ${piece} = piece '${piece}' \n`;
    }
  }
  out += bos.replace(/piece [^;]*;/g, "");
  return out;
}

function convertLittleparts(bos: string): string {
  const find = [
    "//",
    "&&",
    "||",
    "!=",
    "!",
    "TRUE",
    "FALSE",
    "static-var",
    "}",
  ];
  const rep = [
    "--",
    "and",
    "or",
    "~=",
    "not ",
    "true",
    "false",
    "local",
    "end",
  ];
  let out = strReplace(bos, find, rep);
  out = out.replace(/#define\s*(\S*)\s*(\S*)/g, "local $1 = $2");
  return out;
}

function convertBlocks(bos: string): string {
  let out = bos.replace(/(.*)if.*\((.*)\)/g, "$1if $2 then");
  out = out.replace(/(.*)while.*\((.*)\)/g, "$1while $2 do");
  return out;
}

function convertFunctions(bos: string): string {
  let out = strReplace(bos, ["[", "]"], ["", ""]);

  out = pregReplace(out, [
    [/start-script ([^(]*)\(.*\)/g, "StartThread($1)"],
    [/sleep([^;]*);/g, "Sleep($1)"],
    [/set-signal-mask([^;]*);/g, "SetSignalMask($1)"],
    [/signal([^;]*);/g, "Signal($1)"], // must be after set-signal-mask
    [/show([^;]*);/g, "Show($1)"],
    [/hide([^;]*);/g, "Hide($1)"],
    [/emit-sfx(.*)from(.*);/g, "EmitSfx($2, $1)"],

    [
      /turn\s*(.*)\s*to\s*(.)-axis.*<(.*)>.*speed.*<(.*)>\s*\s*;/g,
      "Turn( $1, $2_axis, math.rad($3), math.rad($4) )",
    ],
    [
      /turn\s*(.*)\s*to\s*(.)-axis.*<(.*)>.*speed\s*(.*)\s*\s*;/g,
      "Turn( $1, $2_axis, math.rad($3), math.rad($4) )",
    ],
    [
      /turn\s*(.*)\s*to\s*(.)-axis\s*(.*)\s*speed.*<(.*)>\s*\s*;/g,
      "Turn( $1, $2_axis, math.rad($3), math.rad($4) )",
    ],
    [
      /turn\s*(.*)\s*to\s*(.)-axis\s*(.*)\s*speed\s*(.*)\s*\s*;/g,
      "Turn( $1, $2_axis, math.rad($3), math.rad($4) )",
    ],
    [
      /turn\s*(.*)\s*to\s*(.)-axis.*<(.*)>.*now/g,
      "Turn( $1, $2_axis, math.rad($3) )",
    ],
    [
      /turn\s*(.*)\s*to\s*(.)-axis\s*(.*)\s*now/g,
      "Turn( $1, $2_axis, math.rad($3) )",
    ],

    [/wait-for-turn (.*) around (.)-axis/g, "WaitForTurn($1, $2_axis)"],
    [/wait-for-move (.*) along (.)-axis/g, "WaitForMove($1, $2_axis)"],

    [
      /move\s*(.*)\s*to\s*(.)-axis.*<(.*)>.*speed.*<(.*)>\s*;/g,
      "Move( $1, $2_axis, $3, $4 )",
    ],
    [
      /move\s*(.*)\s*to\s*(.)-axis.*<(.*)>.*speed (.*)\s*;/g,
      "Move( $1, $2_axis, $3, $4 )",
    ],
    [
      /move\s*(.*)\s*to\s*(.)-axis\s*(.*)\s*speed.*<(.*)>\s*;/g,
      "Move( $1, $2_axis, $3, $4 )",
    ],
    [
      /move\s*(.*)\s*to\s*(.)-axis\s*(.*)\s*speed\s*(.*)\s*;/g,
      "Move( $1, $2_axis, $3, $4 )",
    ],
    [/move\s*(.*)\s*to\s*(.)-axis\s*(.*)\s*now/g, "Move( $1, $2_axis, $3 )"],

    [
      /spin\s*(.*)\s*around\s*(.)-axis\s*speed\s*<(.*)>/g,
      "Spin( $1, $2_axis, $3 )",
    ],
    [
      /spin\s*(.*)\s*around\s*(.)-axis\s*speed\s*(.*)/g,
      "Spin( $1, $2_axis, $3 )",
    ],

    [/explode\s+(.*)\s+type\s+(.*);/g, "Explode( $1, <<<$2)"],

    [/\|\s*(\S*)/g, "+ sfx$1"],
    [/<<<\s*(\S*)/g, "sfx$1"],
  ]);

  out = strReplace(
    out,
    ["sfxFALL", "sfxSMOKE", "sfxFIRE", "sfxEXPLODE_ON_HIT", "sfxSHATTER"],
    ["sfxFall", "sfxSmoke", "sfxFire", "sfxExplodeOnHit", "sfxShatter"],
  );

  out = out.replace(
    /Move\( (.*), x_axis, (.*), (.*) \)/g,
    "Move( $1, x_axis, -$2, $3 )",
  );
  out = out.replace(
    /Turn\( (.*), z_axis, math\.rad(.*), (.*) \)/g,
    "Turn( $1, z_axis, math.rad(-$2), $3 )",
  );
  return out;
}

// BOS script call-in names. The replacement remaps Primary/Secondary/Tertiary
// to Weapon1/2/3 and prefixes every name with `function script.`.
const SCRIPT_FCN_FIND = [
  "Create",
  "Killed",
  "StartMoving",
  "StopMoving",
  "QueryWeapon1",
  "QueryWeapon2",
  "QueryWeapon3",
  "QueryPrimary",
  "QuerySecondary",
  "QueryTertiary",
  "AimFromWeapon1",
  "AimFromWeapon2",
  "AimFromWeapon3",
  "AimFromPrimary",
  "AimFromSecondary",
  "AimFromTertiary",
  "AimWeapon1",
  "AimWeapon2",
  "AimWeapon3",
  "AimPrimary",
  "AimSecondary",
  "AimTertiary",
  "Shot1",
  "Shot2",
  "Shot3",
  "Activate",
  "Deactivate",
  "setSFXoccupy",
  "HitByWeapon",
];
const SCRIPT_FCN_REP = [
  "Create",
  "Killed",
  "StartMoving",
  "StopMoving",
  "QueryWeapon1",
  "QueryWeapon2",
  "QueryWeapon3",
  "QueryWeapon1",
  "QueryWeapon2",
  "QueryWeapon3",
  "AimFromWeapon1",
  "AimFromWeapon2",
  "AimFromWeapon3",
  "AimFromWeapon1",
  "AimFromWeapon2",
  "AimFromWeapon3",
  "AimWeapon1",
  "AimWeapon2",
  "AimWeapon3",
  "AimWeapon1",
  "AimWeapon2",
  "AimWeapon3",
  "Shot1",
  "Shot2",
  "Shot3",
  "Activate",
  "Deactivate",
  "setSFXoccupy",
  "HitByWeapon",
];

function convertScriptFcnNames(bos: string): string {
  return strReplace(
    bos,
    SCRIPT_FCN_FIND,
    SCRIPT_FCN_REP.map((s) => `function script.${s}`),
  );
}

function cleanup(bos: string): string {
  let out = bos.replace(/end\s*else/g, "else");
  out = strReplace(out, ["{", ";", "call-script"], ["", "", ""]);
  out = out.replace(/math\.rad\([.0]*\)/g, "0");
  return out;
}

/** Convert a BOS unit script to a (best-effort) Lua unit script. */
export function bos2lua(bos: string): string {
  let out = convertPieces(bos);
  out = convertLittleparts(out);
  out = convertBlocks(out);
  out = convertFunctions(out);
  out = convertScriptFcnNames(out);
  out = cleanup(out);
  return out;
}
