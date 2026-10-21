import { useLingui } from "@lingui/react/macro";
import { cn } from "@picoframe/frame";
import { Star, User, Users } from "lucide-react";
import { NAME_MARK_CLASS, type NameMark } from "./nameMark";

const ICON: Record<NameMark, typeof Star> = {
  you: User,
  friend: Star,
  party: Users,
};

/**
 * The glyph beside a marked name. It says in words what the colour says, so
 * the mark never rests on colour alone, and it is all that marks a name whose
 * text is already tinted with a team colour.
 */
export function NameMarkIcon({
  mark,
  className,
}: {
  mark: NameMark;
  className?: string;
}) {
  const { t } = useLingui();
  const Icon = ICON[mark];
  const label = { you: t`You`, friend: t`Friend`, party: t`In your party` }[
    mark
  ];
  return (
    <Icon
      role="img"
      aria-label={label}
      className={cn("size-3.5 shrink-0", NAME_MARK_CLASS[mark], className)}
    />
  );
}
