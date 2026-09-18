"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { BookOpen, Loader2, RefreshCw, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  updateUserBookAction,
  updateBookDetailsAction,
  deleteUserBookAction,
  refreshBookFromSourceAction,
} from "@/lib/actions";
import type { UserBookWithBook } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function BookDetailForm({ userBook }: { userBook: UserBookWithBook }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(userBook.book.title);
  const [authors, setAuthors] = useState(userBook.book.authors.join(", "));
  const [description, setDescription] = useState(
    userBook.book.description ?? ""
  );
  const [publisher, setPublisher] = useState(userBook.book.publisher ?? "");
  const [genres, setGenres] = useState(userBook.book.genres.join(", "));

  const [status, setStatus] = useState(userBook.status);
  const [rating, setRating] = useState(userBook.rating ?? 0);
  const [notes, setNotes] = useState(userBook.notes ?? "");
  const [tags, setTags] = useState(userBook.tags.join(", "));
  const [moodTags, setMoodTags] = useState(userBook.moodTags.join(", "));
  const [pricePaid, setPricePaid] = useState(userBook.pricePaid ?? "");

  function handleSave() {
    startTransition(async () => {
      await Promise.all([
        updateBookDetailsAction(userBook.bookId, {
          title,
          authors: authors.split(",").map((a) => a.trim()).filter(Boolean),
          description: description || null,
          publisher: publisher || null,
          genres: genres.split(",").map((g) => g.trim()).filter(Boolean),
        }),
        updateUserBookAction(userBook.id, {
          status,
          rating: rating || null,
          notes: notes || null,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          moodTags: moodTags.split(",").map((t) => t.trim()).filter(Boolean),
          pricePaid: pricePaid ? String(pricePaid) : null,
        }),
      ]);
      toast.success("Saved");
      router.refresh();
    });
  }

  function handleRefresh() {
    startTransition(async () => {
      await refreshBookFromSourceAction(userBook.bookId);
      toast.success("Refreshed from source");
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteUserBookAction(userBook.id);
      toast.success("Removed from your library");
      router.push("/shelf");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-4">
        <div className="relative h-40 w-28 shrink-0 overflow-hidden rounded-md bg-muted shadow-sm">
          {userBook.book.coverUrl ? (
            <Image
              src={userBook.book.coverUrl}
              alt={title}
              fill
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <BookOpen className="size-8 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col justify-between">
          <div>
            <p className="text-lg font-semibold leading-tight">{title}</p>
            <p className="text-sm text-muted-foreground">{authors}</p>
            {userBook.book.series && (
              <Badge variant="secondary" className="mt-2">
                {userBook.book.series.name}
                {userBook.book.seriesPosition
                  ? ` #${userBook.book.seriesPosition}`
                  : ""}
              </Badge>
            )}
          </div>

          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(rating === n ? 0 : n)}
                className="p-0.5"
                aria-label={`Rate ${n} stars`}
              >
                <Star
                  className={cn(
                    "size-5",
                    n <= rating
                      ? "fill-primary text-primary"
                      : "text-muted-foreground"
                  )}
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owned">Owned</SelectItem>
              <SelectItem value="reading">Reading</SelectItem>
              <SelectItem value="read">Read</SelectItem>
              <SelectItem value="wishlist">Wishlist</SelectItem>
              <SelectItem value="dnf">Did not finish</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="price">Price paid</Label>
          <Input
            id="price"
            value={pricePaid}
            onChange={(e) => setPricePaid(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="authors">Authors (comma separated)</Label>
        <Input id="authors" value={authors} onChange={(e) => setAuthors(e.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="publisher">Publisher</Label>
        <Input id="publisher" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="genres">Genres (comma separated)</Label>
        <Input id="genres" value={genres} onChange={(e) => setGenres(e.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tags">Tags</Label>
        <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="signed, favorite, annotated" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="moodTags">Vibes / mood tags</Label>
        <Input
          id="moodTags"
          value={moodTags}
          onChange={(e) => setMoodTags(e.target.value)}
          placeholder="cozy, angsty, slow-burn, spicy"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Your notes</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Thoughts, quotes, reread plans..."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save changes
        </Button>
        <Button variant="outline" onClick={handleRefresh} disabled={pending}>
          <RefreshCw className="size-4" />
          Refresh from source
        </Button>
        <Button variant="destructive" onClick={handleDelete} disabled={pending}>
          <Trash2 className="size-4" />
          Remove
        </Button>
      </div>
    </div>
  );
}
