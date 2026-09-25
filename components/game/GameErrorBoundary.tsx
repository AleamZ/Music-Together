"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Called once when the game shell (or its lazily loaded chunk) fails. */
  onError: () => void;
  children: ReactNode;
}

/** Keeps a crash in game mode from taking the whole room down. Import it statically — never from the game chunk. */
export default class GameErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[game] the game view crashed — back to the classic view", error, info.componentStack);
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
