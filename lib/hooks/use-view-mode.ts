"use client";

import { useEffect, useState } from "react";

export type ViewMode = "grid" | "list";

/** Per-page grid/list preference, persisted per-viewer in localStorage.
 * Falls back to `defaultMode` on the server and before hydration reads
 * the stored value, so there's no layout shift beyond a possible flip
 * right after mount. */
export function useViewMode(
  key: string,
  defaultMode: ViewMode
): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(defaultMode);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`view-mode:${key}`);
      if (stored === "grid" || stored === "list") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the persisted preference on mount, not derivable from props/state
        setMode(stored);
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — just use the default
    }
  }, [key]);

  function update(next: ViewMode) {
    setMode(next);
    try {
      localStorage.setItem(`view-mode:${key}`, next);
    } catch {
      // ignore
    }
  }

  return [mode, update];
}
