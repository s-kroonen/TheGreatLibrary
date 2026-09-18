"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { BookOpen, ExternalLink, Loader2, RefreshCw, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  checkCurrentPriceAction,
  updateUserBookAction,
} from "@/lib/actions";
import { retailerSearchLinks } from "@/lib/books/price";
import type { UserBookWithBook } from "@/lib/queries";

export function WishlistItem({ userBook }: { userBook: UserBookWithBook }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleCheckPrice() {
    startTransition(async () => {
      const price = await checkCurrentPriceAction(userBook.id);
      toast(
        price
          ? `Current price: ${price.currency} ${price.amount.toFixed(2)}`
          : "No live price available for this book — try a retailer search."
      );
      router.refresh();
    });
  }

  function handleMoveToOwned() {
    startTransition(async () => {
      await updateUserBookAction(userBook.id, { status: "owned" });
      toast.success(`Moved "${userBook.book.title}" to your shelf`);
      router.refresh();
    });
  }

  const links = retailerSearchLinks(
    `${userBook.book.title} ${userBook.book.authors[0] ?? ""}`
  );

  return (
    <Card>
      <CardContent className="flex gap-4 p-4">
        <Link
          href={`/book/${userBook.id}`}
          className="relative h-24 w-16 shrink-0 overflow-hidden rounded-sm bg-muted"
        >
          {userBook.book.coverUrl ? (
            <Image
              src={userBook.book.coverUrl}
              alt={userBook.book.title}
              fill
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <BookOpen className="size-6 text-muted-foreground" />
            </div>
          )}
        </Link>

        <div className="flex flex-1 flex-col gap-1.5">
          <Link href={`/book/${userBook.id}`} className="font-medium leading-tight">
            {userBook.book.title}
          </Link>
          {userBook.book.authors.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {userBook.book.authors.join(", ")}
            </p>
          )}

          {userBook.currentPrice ? (
            <p className="text-sm font-medium">
              ~{userBook.currentPrice} {userBook.priceSource === "googlebooks" ? "" : ""}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No price checked yet</p>
          )}

          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={handleCheckPrice} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Check price
            </Button>
            <Button size="sm" onClick={handleMoveToOwned} disabled={pending}>
              <ShoppingBag className="size-4" />
              Got it
            </Button>
            {links.map((l) => (
              <Button key={l.name} size="sm" variant="ghost" asChild>
                <a href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.name}
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
