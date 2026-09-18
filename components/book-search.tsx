"use client";

import { useState, useTransition, useDeferredValue, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { BookOpen, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  searchBooksAction,
  addBookAction,
  addManualBookAction,
} from "@/lib/actions";
import type { NormalizedBook } from "@/lib/books/types";

export function BookSearch() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [results, setResults] = useState<NormalizedBook[]>([]);
  const [searching, startSearch] = useTransition();
  const [adding, setAdding] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!deferredQuery.trim()) return;

    const handle = setTimeout(() => {
      startSearch(async () => {
        const found = await searchBooksAction(deferredQuery);
        setResults(found);
        setSearched(true);
      });
    }, 350);
    return () => clearTimeout(handle);
  }, [deferredQuery]);

  const isEmptyQuery = !deferredQuery.trim();
  const displayResults = isEmptyQuery ? [] : results;
  const displaySearched = !isEmptyQuery && searched;

  async function handleAdd(book: NormalizedBook, status: "owned" | "wishlist") {
    setAdding(book.sourceId);
    try {
      await addBookAction(book, status);
      toast.success(
        status === "owned"
          ? `Added "${book.title}" to your shelf`
          : `Added "${book.title}" to your wishlist`
      );
      router.refresh();
    } catch {
      toast.error("Couldn't add that book. Try again.");
    } finally {
      setAdding(null);
    }
  }

  async function handleAddManual() {
    setAdding("manual");
    try {
      await addManualBookAction({ title: query, authors: [], status: "owned" });
      toast.success(`Added "${query}" to your shelf`);
      setQuery("");
      router.refresh();
    } catch {
      toast.error("Couldn't add that book. Try again.");
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, author, or ISBN..."
          className="pl-9"
          autoFocus
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {displayResults.length > 0 && (
        <div className="flex flex-col gap-3">
          {displayResults.map((book) => (
            <Card key={`${book.source}-${book.sourceId}`}>
              <CardContent className="flex gap-4 p-4">
                <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-sm bg-muted">
                  {book.coverUrl ? (
                    <Image
                      src={book.coverUrl}
                      alt={book.title}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <BookOpen className="size-6 text-muted-foreground" />
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-1">
                  <p className="font-medium leading-tight">{book.title}</p>
                  {book.authors.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {book.authors.join(", ")}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {book.seriesName && (
                      <Badge variant="secondary">
                        {book.seriesName}
                        {book.seriesPosition ? ` #${book.seriesPosition}` : ""}
                      </Badge>
                    )}
                    {book.publishedDate && (
                      <Badge variant="outline">{book.publishedDate}</Badge>
                    )}
                  </div>

                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      disabled={adding === book.sourceId}
                      onClick={() => handleAdd(book, "owned")}
                    >
                      {adding === book.sourceId ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      Own it
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={adding === book.sourceId}
                      onClick={() => handleAdd(book, "wishlist")}
                    >
                      Wishlist
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {displaySearched && !searching && displayResults.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No matches for &ldquo;{query}&rdquo;. You can add it manually
              instead.
            </p>
            <Button
              variant="outline"
              disabled={adding === "manual"}
              onClick={handleAddManual}
            >
              {adding === "manual" && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Add &ldquo;{query}&rdquo; manually
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
