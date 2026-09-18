"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  BookOpen,
  Library,
  ListChecks,
  Plus,
  Sparkles,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/shelf", label: "Shelf", icon: Library },
  { href: "/series", label: "Series", icon: BookOpen },
  { href: "/wishlist", label: "Wishlist", icon: ListChecks },
  { href: "/stats", label: "For You", icon: Sparkles },
];

function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- next-themes hydration guard
    setMounted(true);
  }, []);

  return (
    <button
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={className}
      aria-label="Toggle dark mode"
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
      <span className="md:inline">Theme</span>
    </button>
  );
}

export function AppNav({ userName }: { userName: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 md:flex-col md:border-r md:border-border md:p-4">
        <Link href="/shelf" className="flex items-center gap-2 px-2 py-3 text-lg font-semibold">
          <BookOpen className="size-6 text-primary" />
          The Great Library
        </Link>

        <nav className="mt-4 flex flex-1 flex-col gap-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                pathname.startsWith(href)
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>

        <Button asChild className="mb-2">
          <Link href="/add">
            <Plus className="size-4" />
            Add a book
          </Link>
        </Button>

        <ThemeToggle className="flex h-11 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" />

        <button
          onClick={handleSignOut}
          className="flex h-11 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="size-4" />
          Sign out, {userName.split(" ")[0]}
        </button>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 backdrop-blur md:hidden">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium",
              pathname.startsWith(href)
                ? "text-primary"
                : "text-muted-foreground"
            )}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
        <Link
          href="/add"
          className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium text-muted-foreground"
        >
          <Plus className="size-5" />
          Add
        </Link>
      </nav>
    </>
  );
}
