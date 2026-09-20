"use client";

import {
  useState,
  useTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { BookOpen, Check, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  searchBooksAction,
  addBookAction,
  addManualBookAction,
  type SearchResult,
} from "@/lib/actions";
import { normalizeLanguage, type LanguageFilter } from "@/lib/books/language";

const LANGUAGE_OPTIONS: { value: LanguageFilter; label: string }[] = [
  { value: "en", label: "English" },
  { value: "nl", label: "Dutch" },
];

export function BookSearch() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, startSearch] = useTransition();
  const [adding, setAdding] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [languages, setLanguages] = useState<Set<LanguageFilter>>(
    new Set(["en", "nl"])
  );
  const [showOtherLanguages, setShowOtherLanguages] = useState(false);
  const [genre, setGenre] = useState("all");
  const router = useRouter();
  const requestId = useRef(0);

  useEffect(() => {
    if (!deferredQuery.trim()) return;

    const handle = setTimeout(() => {
      const thisRequest = ++requestId.current;
      startSearch(async () => {
        const found = await searchBooksAction(deferredQuery);
        // Ignore this response if a newer keystroke already kicked off
        // another search — otherwise a slower earlier request can land
        // after a faster later one and flash outdated results.
        if (thisRequest !== requestId.current) return;
        setResults(found);
        setSearched(true);
        setGenre("all");
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [deferredQuery]);

  const isEmptyQuery = !deferredQuery.trim();
  const displaySearched = !isEmptyQuery && searched;

  const rawResults = useMemo(
    () => (isEmptyQuery ? [] : results),
    [isEmptyQuery, results]
  );

  const languageFiltered = useMemo(
    () =>
      rawResults.filter((r) => {
        const lang = normalizeLanguage(r.language);
        if (lang === undefined) return true; // unknown — never hidden
        if (lang === "other") return showOtherLanguages;
        return languages.has(lang);
      }),
    [rawResults, languages, showOtherLanguages]
  );

  const genreOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of languageFiltered) for (const g of r.genres) set.add(g);
    return Array.from(set).sort();
  }, [languageFiltered]);

  const displayResults = languageFiltered.filter(
    (r) => genre === "all" || r.genres.includes(genre)
  );

  function toggleLanguage(lang: LanguageFilter) {
    setLanguages((prev) => {
      const next = new Set(prev);
      if (next.has(lang)) next.delete(lang);
      else next.add(lang);
      return next;
    });
  }

  async function handleAdd(book: SearchResult, status: "owned" | "wishlist") {
    setAdding(book.sourceId);
    try {
      await addBookAction(book, status);
      setResults((prev) =>
        prev.map((r) =>
          r.source === book.source && r.sourceId === book.sourceId
            ? { ...r, existingStatus: status }
            : r
        )
      );
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

      <div className="flex flex-wrap items-center gap-2">
        {LANGUAGE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            size="sm"
            variant={languages.has(opt.value) ? "default" : "outline"}
            onClick={() => toggleLanguage(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={showOtherLanguages ? "default" : "outline"}
          onClick={() => setShowOtherLanguages((v) => !v)}
        >
          Other languages
        </Button>

        {genreOptions.length > 0 && (
          <Select value={genre} onValueChange={setGenre}>
            <SelectTrigger className="ml-auto w-40">
              <SelectValue placeholder="Genre" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All genres</SelectItem>
              {genreOptions.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {displayResults.length > 0 && (
        <div className="flex flex-col gap-3">
          {displayResults.map((book) => {
            const isOwned =
              !!book.existingStatus && book.existingStatus !== "wishlist";
            const isWishlisted = book.existingStatus === "wishlist";
            const busy = adding === book.sourceId;

            return (
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
                        disabled={busy || isOwned}
                        onClick={() => handleAdd(book, "owned")}
                      >
                        {busy ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : isOwned ? (
                          <Check className="size-4" />
                        ) : (
                          <Plus className="size-4" />
                        )}
                        {isOwned ? "Owned" : "Own it"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || isOwned || isWishlisted}
                        onClick={() => handleAdd(book, "wishlist")}
                      >
                        {isWishlisted && <Check className="size-4" />}
                        {isWishlisted ? "Wishlisted" : "Wishlist"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {displaySearched && !searching && displayResults.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {rawResults.length > 0
                ? "No matches for the current filters."
                : `No matches for “${query}”. You can add it manually instead.`}
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
