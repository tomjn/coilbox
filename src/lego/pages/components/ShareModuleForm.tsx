/**
 * "Share this module" (#3272): a code, a link and a publish to the Coilbox
 * hub, through `ChallengeCodeView` like every other shareable kind. A module
 * holding game geometry gets the reason instead, and no code.
 */

import { t } from "@lingui/core/macro";
import { ChallengeCodeView } from "@/challenge/ChallengeCodeView";
import type { LegoProject } from "../../model";
import { moduleShareCode } from "../../moduleShare";

export function ShareModuleForm({ module }: { module: LegoProject }) {
  const made = moduleShareCode(module);
  if (!made.ok) {
    return <p className="p-4 text-sm text-muted-foreground">{made.reason}</p>;
  }
  return (
    <ChallengeCodeView
      code={made.code}
      helpText={t`Anyone who opens this gets the module in their unit builder.`}
    />
  );
}
