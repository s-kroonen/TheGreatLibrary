"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  enableWishlistShareAction,
  revokeWishlistShareAction,
} from "@/lib/actions";

export function ShareWishlistDialog({
  initialToken,
}: {
  initialToken: string | null;
}) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const url =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/share/${token}`
      : "";

  function handleEnable() {
    startTransition(async () => {
      const t = await enableWishlistShareAction();
      setToken(t);
      router.refresh();
    });
  }

  function handleRevoke() {
    startTransition(async () => {
      await revokeWishlistShareAction();
      setToken(null);
      setCopied(false);
      toast.success("Sharing turned off — the old link no longer works");
      router.refresh();
    });
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog onOpenChange={(open) => open && !token && handleEnable()}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 className="size-4" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share your wishlist</DialogTitle>
          <DialogDescription>
            Anyone with this link can view your wishlist — no account
            needed. Turn it off any time to revoke access.
          </DialogDescription>
        </DialogHeader>

        {pending && !token ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : token ? (
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <Input value={url} readOnly onFocus={(e) => e.target.select()} />
              <Button size="icon" variant="outline" onClick={handleCopy}>
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={pending}
              className="w-fit"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Stop sharing
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">
              Sharing is off. Turn it back on to get a new link.
            </p>
            <Button onClick={handleEnable} disabled={pending} className="w-fit">
              {pending && <Loader2 className="size-4 animate-spin" />}
              Share again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
