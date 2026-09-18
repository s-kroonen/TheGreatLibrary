import { BookSearch } from "@/components/book-search";

export default function AddBookPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a book</h1>
        <p className="text-sm text-muted-foreground">
          Just start typing a title — we&apos;ll look it up and fill in the
          rest.
        </p>
      </div>
      <BookSearch />
    </div>
  );
}
