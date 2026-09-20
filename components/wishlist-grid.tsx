import Link from "next/link";

import { BookCover } from "@/components/book-cover";
import { Badge } from "@/components/ui/badge";
import type { UserBookWithBook } from "@/lib/queries";

export function WishlistGrid({ books }: { books: UserBookWithBook[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {books.map((ub) => (
        <Link
          key={ub.id}
          href={`/book/${ub.id}`}
          className="group flex flex-col gap-2"
        >
          <BookCover coverUrl={ub.book.coverUrl} title={ub.book.title}>
            {ub.currentPrice && (
              <Badge
                variant="secondary"
                className="absolute bottom-1.5 right-1.5 text-[10px]"
              >
                ~{ub.currentPrice}
              </Badge>
            )}
          </BookCover>
          <div className="flex flex-col">
            <p className="line-clamp-2 text-sm font-medium leading-tight">
              {ub.book.title}
            </p>
            {ub.book.authors.length > 0 && (
              <p className="line-clamp-1 text-xs text-muted-foreground">
                {ub.book.authors.join(", ")}
              </p>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
