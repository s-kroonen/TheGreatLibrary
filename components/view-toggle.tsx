"use client";

import { LayoutGrid, List } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/hooks/use-view-mode";

export function ViewToggle({
  mode,
  onChange,
  className,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-md border border-input",
        className
      )}
    >
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Grid view"
        aria-pressed={mode === "grid"}
        className={cn(
          "rounded-none",
          mode === "grid" && "bg-accent text-accent-foreground"
        )}
        onClick={() => onChange("grid")}
      >
        <LayoutGrid className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="List view"
        aria-pressed={mode === "list"}
        className={cn(
          "rounded-none border-l border-input",
          mode === "list" && "bg-accent text-accent-foreground"
        )}
        onClick={() => onChange("list")}
      >
        <List className="size-4" />
      </Button>
    </div>
  );
}
