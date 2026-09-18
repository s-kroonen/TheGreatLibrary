import { Library } from "lucide-react";

import { requireUser } from "@/lib/session";
import { getSeriesOverview } from "@/lib/queries";
import { SeriesCard } from "@/components/series-card";

export default async function SeriesPage() {
  const user = await requireUser();
  const series = await getSeriesOverview(user!.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Series</h1>
        <p className="text-sm text-muted-foreground">
          Track which volumes you have, and spot what&apos;s missing.
        </p>
      </div>

      {series.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-20 text-center">
          <Library className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">
            No series detected yet. Add a few books from the same series to
            see them tracked here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {series.map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
        </div>
      )}
    </div>
  );
}
