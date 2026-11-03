import { Component, type ReactNode } from "react"

/** Keep lazy-module and render failures from unmounting the entire app. */
export class PreviewErrorBoundary extends Component<
  { children: ReactNode; downloadUrl: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="space-y-3 p-4 text-sm">
        <p>PDF preview failed. You can still download the file.</p>
        <pre className="whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{this.state.error.name}: {this.state.error.message}</pre>
        <p className="text-muted-foreground">Please share this error when reporting the problem.</p>
        <a className="underline" href={this.props.downloadUrl}>Download PDF</a>
      </div>
    )
  }
}
