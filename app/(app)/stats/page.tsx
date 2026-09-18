import { Sparkles } from "lucide-react";

import { requireUser } from "@/lib/session";
import { getStats, getUserBooks } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function StatsPage() {
  const user = await requireUser();
  const stats = await getStats(user!.id);
  const books = await getUserBooks(user!.id);

  const moodCounts = new Map<string, number>();
  for (const ub of books) {
    for (const m of ub.moodTags) moodCounts.set(m, (moodCounts.get(m) ?? 0) + 1);
  }
  const moods = Array.from(moodCounts.entries()).sort((a, b) => b[1] - a[1]);

  const ratings = books.map((b) => b.rating).filter((r): r is number => !!r);
  const avgRating = ratings.length
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : null;

  const maxGenreCount = Math.max(1, ...stats.topGenres.map(([, c]) => c));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Sparkles className="size-6 text-primary" />
        <h1 className="text-2xl font-semibold">For you</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Owned", value: stats.totalOwned },
          { label: "Reading", value: stats.currentlyReading },
          { label: "Read", value: stats.totalRead },
          { label: "Wishlist", value: stats.totalWishlist },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-semibold">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {avgRating && (
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-semibold">{avgRating} ★</p>
            <p className="text-xs text-muted-foreground">
              average rating across {ratings.length} rated books
            </p>
          </CardContent>
        </Card>
      )}

      {stats.topGenres.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your favorite genres</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {stats.topGenres.map(([genre, count]) => (
              <div key={genre} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-sm">{genre}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(count / maxGenreCount) * 100}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right text-sm text-muted-foreground">
                  {count}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {moods.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your reading vibes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {moods.map(([mood, count]) => (
              <Badge key={mood} variant="secondary" className="text-sm">
                {mood} · {count}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {stats.totalOwned === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          Add some books and rate them to unlock your reading stats.
        </p>
      )}
    </div>
  );
}
