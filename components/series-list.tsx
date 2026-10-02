"use client";

import { useState } from "react";
import { ChevronDown, Library, Search as SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookCover } from "@/components/book-cover";
import { SeriesCard } from "@/components/series-card";
import { ViewToggle } from "@/components/view-toggle";
import { useViewMode } from "@/lib/hooks/use-view-mode";
import { cn } from "@/lib/utils";
import type { getSeriesOverview } from "@/lib/queries";

type SeriesInfo = Awaited<ReturnType<typeof getSeriesOverview>>[number];

type Completion = "all" | "complete" | "incomplete" | "wishlisted";
type SortKey = "name" | "progress" | "owned" | "missing";

function completionOf(s: SeriesInfo) {
  const total = s.total ?? s.haveCount;
  return total ? s.haveCount / total : 1;
}

const sorters: Record<SortKey, (a: SeriesInfo, b: SeriesInfo) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  // Closest to finished first — the ones worth completing.
  progress: (a, b) => completionOf(b) - completionOf(a) || a.name.localeCompare(b.name),
  owned: (a, b) => b.haveCount - a.haveCount || a.name.localeCompare(b.name),
  missing: (a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name),
};

export function SeriesList({ series }: { series: SeriesInfo[] }) {
  const [query, setQuery] = useState("");
  const [completion, setCompletion] = useState<Completion>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [view, setView] = useViewMode("series", "grid");
  const [expanded, setExpanded] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const filtered = series
    .filter((s) => {
      if (completion === "complete" && s.missing.length > 0) return false;
      if (completion === "incomplete" && s.missing.length === 0) return false;
      if (completion === "wishlisted" && !s.books.some((b) => b.status === "wishlist")) {
        return false;
      }
      if (!needle) return true;
      // Series name, or any book in it (title/author) — people often
      // remember the book, not what the series is called.
      const haystack = [
        s.name,
        ...s.books.map((b) => `${b.book.title} ${b.book.authors.join(" ")}`),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    })
    .sort(sorters[sort]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search series, books or authors..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={completion} onValueChange={(v) => setCompletion(v as Completion)}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Show" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All series</SelectItem>
              <SelectItem value="incomplete">Missing books</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
              <SelectItem value="wishlisted">Has wishlist</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="progress">Most complete</SelectItem>
              <SelectItem value="owned">Most owned</SelectItem>
              <SelectItem value="missing">Most missing</SelectItem>
            </SelectContent>
          </Select>
          <ViewToggle mode={view} onChange={setView} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} of {series.length} series
      </p>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Library className="size-8" />
          <p>No series match.</p>
        </div>
      ) : view === "grid" ? (
        // Wider than the shelf grid: each tile shows a whole row of covers
        // plus the missing volumes, so 1-3 columns instead of 2-4.
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((s) => {
            const total = s.total ?? s.haveCount;
            const pct = Math.round(completionOf(s) * 100);
            const open = expanded === s.id;
            const lead = s.books[0]?.book;
            return (
              <div key={s.id} className="flex flex-col gap-2">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : s.id)}
                  className="flex min-h-11 items-center gap-3 rounded-lg border border-border p-2.5 text-left transition-colors hover:bg-accent"
                >
                  <BookCover
                    coverUrl={lead?.coverUrl}
                    title={lead?.title ?? s.name}
                    className="w-14 shrink-0"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <p className="truncate text-sm font-medium leading-tight">{s.name}</p>
                    <Progress value={pct} />
                    <p className="text-xs text-muted-foreground">
                      {s.missing.length > 0
                        ? `Missing ${s.missing.length} ${s.missing.length === 1 ? "book" : "books"}`
                        : "Complete"}
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {s.haveCount} / {total ?? "?"}
                  </Badge>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      open && "rotate-180"
                    )}
                  />
                </button>
                {open && <SeriesCard series={s} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
