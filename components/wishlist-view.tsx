"use client";

import { ListChecks } from "lucide-react";

import { WishlistItem } from "@/components/wishlist-item";
import { WishlistGrid } from "@/components/wishlist-grid";
import { ViewToggle } from "@/components/view-toggle";
import { useViewMode } from "@/lib/hooks/use-view-mode";
import type { UserBookWithBook } from "@/lib/queries";

export function WishlistView({ books }: { books: UserBookWithBook[] }) {
  const [view, setView] = useViewMode("wishlist", "list");

  if (books.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-20 text-center">
        <ListChecks className="size-8 text-muted-foreground" />
        <p className="text-muted-foreground">Your wishlist is empty.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <ViewToggle mode={view} onChange={setView} />
      </div>

      {view === "grid" ? (
        <WishlistGrid books={books} />
      ) : (
        <div className="flex flex-col gap-3">
          {books.map((ub) => (
            <WishlistItem key={ub.id} userBook={ub} />
          ))}
        </div>
      )}
    </div>
  );
}
