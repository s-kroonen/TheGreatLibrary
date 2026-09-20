"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { BookOpen, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addMissingSeriesBooksToWishlistAction } from "@/lib/actions";
import type { getSeriesOverview } from "@/lib/queries";

type SeriesInfo = Awaited<ReturnType<typeof getSeriesOverview>>[number];

export function SeriesCard({ series }: { series: SeriesInfo }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const total = series.total ?? series.haveCount;
  const pct = total ? Math.round((series.haveCount / total) * 100) : 100;

  function handleAddMissing() {
    startTransition(async () => {
      const added = await addMissingSeriesBooksToWishlistAction(series.name);
      toast.success(
        added > 0
          ? `Added ${added} missing book${added > 1 ? "s" : ""} to your wishlist`
          : "Nothing new found for this series"
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{series.name}</CardTitle>
          <Badge variant="secondary">
            {series.haveCount} / {total ?? "?"}
          </Badge>
        </div>
        <Progress value={pct} className="mt-1" />
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {series.books.map((ub) => (
            <Link
              key={ub.id}
              href={`/book/${ub.id}`}
              className={cn(
                "relative aspect-[2/3] w-16 shrink-0 overflow-hidden rounded-sm bg-muted",
                ub.status === "wishlist" && "opacity-60 ring-2 ring-primary/50"
              )}
            >
              {ub.book.coverUrl ? (
                <Image
                  src={ub.book.coverUrl}
                  alt={ub.book.title}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <BookOpen className="size-4 text-muted-foreground" />
                </div>
              )}
              {ub.status === "wishlist" && (
                <span className="absolute inset-x-0 top-0 bg-primary/90 px-1 py-0.5 text-center text-[9px] font-medium text-primary-foreground">
                  Wishlist
                </span>
              )}
              <span className="absolute bottom-0.5 right-0.5 rounded bg-background/90 px-1 text-[10px] font-medium">
                #{ub.book.seriesPosition ?? "?"}
              </span>
            </Link>
          ))}
        </div>

        {series.missing.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Missing: {series.missing.map((n) => `#${n}`).join(", ")}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddMissing}
              disabled={pending}
              className="w-fit"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add missing to wishlist
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
