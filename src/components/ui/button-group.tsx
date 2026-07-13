import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn ButtonGroup, vendored from the registry. Trimmed to the `ButtonGroup`
 * wrapper only - the registry's `ButtonGroupText` / `ButtonGroupSeparator`
 * sub-components need the `separator` primitive, which this project deliberately
 * doesn't vendor. The wrapper flushes adjacent buttons into a single segmented
 * control (shared edge, squared inner corners) via CSS on its direct children.
 */
const buttonGroupVariants = cva(
  "flex w-fit items-stretch has-[>[data-slot=button-group]]:gap-2 [&>*]:focus-visible:relative [&>*]:focus-visible:z-10 [&>input]:flex-1",
  {
    variants: {
      orientation: {
        horizontal:
          "[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none",
        vertical:
          "flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
    },
  },
);

function ButtonGroup({
  className,
  orientation,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a button group is a role=group action cluster, not a form <fieldset>
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  );
}

export { ButtonGroup, buttonGroupVariants };
