import { requireUser } from "@/lib/session";
import { getUserBooks, getWishlistShare } from "@/lib/queries";
import { WishlistView } from "@/components/wishlist-view";
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

      <WishlistView books={wishlist} />
    </div>
  );
}
