import Image from "next/image";

import { cn } from "@/lib/utils";

export function BookCover({
  coverUrl,
  title,
  className,
  dimmed,
  children,
}: {
  coverUrl?: string | null;
  title: string;
  className?: string;
  dimmed?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative aspect-[2/3] w-full overflow-hidden rounded-md bg-muted shadow-sm",
        dimmed && "opacity-60 ring-2 ring-primary/50",
        className
      )}
    >
      {coverUrl ? (
        <Image src={coverUrl} alt={title} fill className="object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center p-2">
          <p className="line-clamp-4 text-center text-xs font-medium text-muted-foreground">
            {title}
          </p>
        </div>
      )}
      {children}
    </div>
  );
}
