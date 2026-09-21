import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------- Better Auth tables ----------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ---------- Library domain ----------

export interface SeriesVolume {
  position: number;
  title: string;
  coverUrl?: string;
  isbn13?: string;
  isbn10?: string;
  /** Which provider `sourceId` belongs to (Open Library work "/works/OL…W",
   * or a Google Books volume id), plus authors — enough to turn a lineup
   * entry back into a book we can add to a wishlist. */
  source?: "openlibrary" | "googlebooks";
  sourceId?: string;
  authors?: string[];
}

export const series = pgTable(
  "series",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    source: text("source"),
    sourceId: text("source_id"),
    expectedCount: integer("expected_count"),
    // The full lineup of the series as discovered from external search —
    // not just what this app's users happen to own. Lets us show what's
    // actually missing, not just "you have fewer books than your own max
    // position." Re-looked-up lazily; lookedUpAt lets us treat a stale
    // cache as unset without re-querying on every page load.
    knownVolumes: jsonb("known_volumes").$type<SeriesVolume[]>(),
    lookedUpAt: timestamp("looked_up_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("series_source_idx").on(t.source, t.sourceId)]
);

// A canonical book/edition record, shared across all users, populated
// from search or external source lookups (Open Library / Google Books / ...).
export const book = pgTable(
  "book",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    authors: jsonb("authors").$type<string[]>().notNull().default([]),
    isbn10: text("isbn10"),
    isbn13: text("isbn13"),
    coverUrl: text("cover_url"),
    description: text("description"),
    publisher: text("publisher"),
    publishedDate: text("published_date"),
    pageCount: integer("page_count"),
    language: text("language"),
    genres: jsonb("genres").$type<string[]>().notNull().default([]),

    seriesId: text("series_id").references(() => series.id, {
      onDelete: "set null",
    }),
    seriesPosition: numeric("series_position"),
    // When a series lookup last ran for this book without finding one, so
    // the startup backfill doesn't re-query every standalone book on every
    // boot.
    seriesCheckedAt: timestamp("series_checked_at"),

    source: text("source"), // "openlibrary" | "googlebooks" | "manual"
    sourceId: text("source_id"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("book_title_idx").on(t.title),
    index("book_series_idx").on(t.seriesId),
    uniqueIndex("book_source_idx").on(t.source, t.sourceId),
  ]
);

export const userBookStatusValues = [
  "owned",
  "wishlist",
  "reading",
  "read",
  "dnf",
] as const;
export type UserBookStatus = (typeof userBookStatusValues)[number];

// A user's personal relationship to a book: ownership status, shelf,
// rating, notes, manual overrides, price tracking, etc.
export const userBook = pgTable(
  "user_book",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => book.id, { onDelete: "cascade" }),

    status: text("status").$type<UserBookStatus>().notNull().default("owned"),
    rating: integer("rating"), // 1-5
    notes: text("notes"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    moodTags: jsonb("mood_tags").$type<string[]>().notNull().default([]),
    format: text("format"), // physical | ebook | audiobook
    condition: text("condition"),
    shelf: text("shelf"),

    pricePaid: numeric("price_paid"),
    currentPrice: numeric("current_price"),
    priceCheckedAt: timestamp("price_checked_at"),
    priceSource: text("price_source"),
    priceUrl: text("price_url"),

    // manual overrides layered on top of the shared `book` record
    overrides: jsonb("overrides").$type<Record<string, unknown>>(),

    addedAt: timestamp("added_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_book_unique_idx").on(t.userId, t.bookId),
    index("user_book_user_idx").on(t.userId),
    index("user_book_status_idx").on(t.userId, t.status),
  ]
);

// A public, unauthenticated share link for a user's wishlist. Presence of
// a row = sharing is on; deleting it revokes the link immediately.
export const wishlistShare = pgTable("wishlist_share", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Relations ----------

export const seriesRelations = relations(series, ({ many }) => ({
  books: many(book),
}));

export const bookRelations = relations(book, ({ one, many }) => ({
  series: one(series, { fields: [book.seriesId], references: [series.id] }),
  userBooks: many(userBook),
}));

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  books: many(userBook),
  wishlistShare: one(wishlistShare, {
    fields: [user.id],
    references: [wishlistShare.userId],
  }),
}));

export const userBookRelations = relations(userBook, ({ one }) => ({
  user: one(user, { fields: [userBook.userId], references: [user.id] }),
  book: one(book, { fields: [userBook.bookId], references: [book.id] }),
}));
