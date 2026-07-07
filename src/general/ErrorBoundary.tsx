import { Button } from "@picoframe/frame";
import { AlertCircle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * App-wide safety net. A render-time throw anywhere below `<AppFrame>` would
 * otherwise white-screen the whole shell with no message and no recovery; this
 * catches it and offers a Reload instead. Styled to match the destructive
 * banners in `content/pages/components/states.tsx` so it reads as "part of the
 * app", not a raw crash.
 *
 * It intentionally does NOT reset on prop change: once a page has thrown, the
 * safe action is a full reload, not silently re-rendering the same broken tree.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("coilbox: render error caught by boundary", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="flex h-full min-h-0 flex-col items-center justify-center gap-4 p-10 text-center">
        <div className="flex max-w-lg flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-left text-sm">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            Something went wrong
          </div>
          <p className="text-muted-foreground">
            The screen you were on hit an unexpected error. Reloading usually
            clears it. If this keeps happening, note what you were doing and
            report it.
          </p>
          <details className="rounded-md border border-border/50 bg-card p-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Error details
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
            </pre>
          </details>
        </div>
        <Button onClick={() => location.reload()}>Reload</Button>
      </main>
    );
  }
}
