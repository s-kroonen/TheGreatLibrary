import { ListChecks } from "lucide-react";

import { requireUser } from "@/lib/session";
import { getUserBooks, getWishlistShare } from "@/lib/queries";
import { WishlistItem } from "@/components/wishlist-item";
import { ShareWishlistDialog } from "@/components/share-wishlist-dialog";

export default async function WishlistPage() {
  const user = await requireUser();
  const books = await getUserBooks(user!.id);
  const wishlist = books.filter((b) => b.status === "wishlist");
  const shareToken = await getWishlistShare(user!.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Wishlist</h1>
          <p className="text-sm text-muted-foreground">
            {wishlist.length} {wishlist.length === 1 ? "book" : "books"} you&apos;re after
          </p>
        </div>
        <ShareWishlistDialog initialToken={shareToken} />
      </div>

      {wishlist.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-20 text-center">
          <ListChecks className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">Your wishlist is empty.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {wishlist.map((ub) => (
            <WishlistItem key={ub.id} userBook={ub} />
          ))}
        </div>
      )}
    </div>
  );
}
