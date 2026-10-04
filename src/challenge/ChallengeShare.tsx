import { type ComponentProps, useState } from "react";
import { CheckField } from "@/components/Field";
import { ChallengeCodeView } from "./ChallengeCodeView";
import { describeBest, shareText } from "./record";
import { useChallengeRecords } from "./useChallengeRecords";

/**
 * The share drawer for a conquest or warpath challenge. It is `ChallengeCodeView`
 * plus a checkbox, off by default, to copy your best result as a line of text
 * under the code. The line is a claim, and the code itself does not change.
 *
 * The checkbox only appears once there is a result to share.
 */
export function ChallengeShare({
  identity,
  ...view
}: ComponentProps<typeof ChallengeCodeView> & { identity: string | null }) {
  const { records } = useChallengeRecords();
  const [include, setInclude] = useState(false);
  const best = identity ? records[identity]?.best : null;
  return (
    <ChallengeCodeView
      {...view}
      copyText={shareText(view.code, include && best ? best : undefined)}
      extra={
        best ? (
          <CheckField
            label="Include my best result as text"
            hint={`Copy code adds a line under the code: "${describeBest(best)}". It is your claim, and coilbox does not check it.`}
            checked={include}
            onChange={setInclude}
          />
        ) : null
      }
    />
  );
}
