import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";

import { requireUser } from "@/lib/session";
import { getUserBooks } from "@/lib/queries";
import { BookGrid } from "@/components/book-grid";
import { Button } from "@/components/ui/button";

export default async function ShelfPage() {
  const user = await requireUser();
  const books = await getUserBooks(user!.id);
  const owned = books.filter((b) => b.status !== "wishlist");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your shelf</h1>
          <p className="text-sm text-muted-foreground">
            {owned.length} {owned.length === 1 ? "book" : "books"}
          </p>
        </div>
        <Button asChild size="sm" className="hidden sm:flex">
          <Link href="/add">
            <Plus className="size-4" />
            Add book
          </Link>
        </Button>
      </div>

      {owned.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-20 text-center">
          <BookOpen className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">Your shelf is empty.</p>
          <Button asChild>
            <Link href="/add">
              <Plus className="size-4" />
              Add your first book
            </Link>
          </Button>
        </div>
      ) : (
        <BookGrid books={owned} />
      )}
    </div>
  );
}
