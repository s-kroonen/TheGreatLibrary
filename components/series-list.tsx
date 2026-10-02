"use client";

import { useState } from "react";
import { Search as SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { SeriesCard } from "@/components/series-card";
import type { getSeriesOverview } from "@/lib/queries";

type SeriesInfo = Awaited<ReturnType<typeof getSeriesOverview>>[number];

export function SeriesList({ series }: { series: SeriesInfo[] }) {
  const [query, setQuery] = useState("");

  const filtered = query
    ? series.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
    : series;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your series..."
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No series match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
        </div>
      )}
    </div>
  );
}
