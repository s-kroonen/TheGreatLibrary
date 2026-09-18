"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { BookOpen, Search, Star } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UserBookWithBook } from "@/lib/queries";

const statusLabel: Record<string, string> = {
  owned: "Owned",
  reading: "Reading",
  read: "Read",
  wishlist: "Wishlist",
  dnf: "DNF",
};

export function BookGrid({ books }: { books: UserBookWithBook[] }) {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const ub of books) for (const g of ub.book.genres) set.add(g);
    return Array.from(set).sort();
  }, [books]);

  const filtered = books.filter((ub) => {
    if (status !== "all" && ub.status !== status) return false;
    if (genre !== "all" && !ub.book.genres.includes(genre)) return false;
    if (query) {
      const haystack = `${ub.book.title} ${ub.book.authors.join(" ")}`.toLowerCase();
      if (!haystack.includes(query.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your shelf..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="owned">Owned</SelectItem>
              <SelectItem value="reading">Reading</SelectItem>
              <SelectItem value="read">Read</SelectItem>
              <SelectItem value="dnf">DNF</SelectItem>
            </SelectContent>
          </Select>
          {genres.length > 0 && (
            <Select value={genre} onValueChange={setGenre}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Genre" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All genres</SelectItem>
                {genres.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <BookOpen className="size-8" />
          <p>No books match yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {filtered.map((ub) => (
            <Link
              key={ub.id}
              href={`/book/${ub.id}`}
              className="group flex flex-col gap-2"
            >
              <div className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-muted shadow-sm transition-transform group-active:scale-[0.98]">
                {ub.book.coverUrl ? (
                  <Image
                    src={ub.book.coverUrl}
                    alt={ub.book.title}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-2">
                    <p className="line-clamp-4 text-center text-xs font-medium text-muted-foreground">
                      {ub.book.title}
                    </p>
                  </div>
                )}
                <Badge
                  variant="secondary"
                  className="absolute left-1.5 top-1.5 text-[10px]"
                >
                  {statusLabel[ub.status]}
                </Badge>
                {ub.rating && (
                  <div className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-medium">
                    <Star className="size-3 fill-primary text-primary" />
                    {ub.rating}
                  </div>
                )}
              </div>
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
      )}
    </div>
  );
}
