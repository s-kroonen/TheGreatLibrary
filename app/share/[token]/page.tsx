import { notFound } from "next/navigation";
import Image from "next/image";
import { BookOpen, ExternalLink, Sparkles } from "lucide-react";

import { getPublicWishlist } from "@/lib/queries";
import { retailerSearchLinks } from "@/lib/books/price";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function SharedWishlistPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getPublicWishlist(token);

  if (!data) notFound();

  const { ownerName, books } = data;
  const firstName = ownerName.split(" ")[0];

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center gap-2">
        <Sparkles className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{firstName}&apos;s wishlist</h1>
          <p className="text-sm text-muted-foreground">
            {books.length} {books.length === 1 ? "book" : "books"} — shared via The Great Library
          </p>
        </div>
      </div>

      {books.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-20 text-center">
          <BookOpen className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">Nothing on the wishlist yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {books.map((ub) => {
            const links = retailerSearchLinks(
              `${ub.book.title} ${ub.book.authors[0] ?? ""}`
            );
            return (
              <Card key={ub.id}>
                <CardContent className="flex gap-4 p-4">
                  <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-sm bg-muted">
                    {ub.book.coverUrl ? (
                      <Image
                        src={ub.book.coverUrl}
                        alt={ub.book.title}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <BookOpen className="size-6 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-1.5">
                    <p className="font-medium leading-tight">{ub.book.title}</p>
                    {ub.book.authors.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        {ub.book.authors.join(", ")}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-2">
                      {links.map((l) => (
                        <Button key={l.name} size="sm" variant="outline" asChild>
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
          })}
        </div>
      )}
    </div>
  );
}
