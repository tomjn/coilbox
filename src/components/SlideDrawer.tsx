import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

/**
 * A viewport-anchored right-hand drawer: a titled header, a click-away
 * backdrop, and a slide transition driven by `open`. Children mount only
 * while open, so each visit starts fresh. Portalled to `<body>` so `fixed
 * inset-y-0` really means the viewport - a transformed/filtered ancestor
 * would otherwise become the positioning box and cut the drawer short of the
 * window bottom.
 */
export function SlideDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return createPortal(
    <>
      {open && (
        <button
          type="button"
          aria-label={`Close ${title}`}
          className="fixed inset-0 z-40 bg-black/20"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-96 max-w-full flex-col border-l border-border bg-background shadow-lg transition-transform motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        inert={!open}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button className="h-7 px-2" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>
        {open && children}
      </aside>
    </>,
    document.body,
  );
}
