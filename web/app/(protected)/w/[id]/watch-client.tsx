"use client";

import { useEffect, useState } from "react";
import { Share2, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth-client";

import { Button } from "@/components/ui/button";

interface WatchClientProps {
  videoId: string;
  initialLikes: number;
}

function formatCount(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export default function WatchClient({
  videoId,
  initialLikes,
}: WatchClientProps) {
  const likedKey = `vidora:liked:${videoId}`;
  const { data: session } = useSession();

  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(false);
  const [_liking, setLiking] = useState(false);

  // Restore liked state from sessionStorage on mount
  useEffect(() => {
    if (sessionStorage.getItem(likedKey)) {
      setLiked(true);
    }
  }, [likedKey]);

  // Track view
  useEffect(() => {
    const viewedKey = `vidora:viewed:${videoId}`;
    if (sessionStorage.getItem(viewedKey)) return;

    void fetch(`/api/videos/${videoId}/view`, { method: "POST" }).then(() => {
      sessionStorage.setItem(viewedKey, "1");
    });
  }, [videoId]);

  const handleLike = async () => {
    if (!session) {
      toast.error("Please log in to like videos");
      return;
    }

    // Check if already liked - toggle dislike
    if (liked) {
      setLiked(false);
      setLikes((prev) => prev - 1);
      setLiking(true);

      try {
        const res = await fetch(`/api/videos/${videoId}/like`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed");
        const data = (await res.json()) as { likes: number };
        setLikes(data.likes);
        sessionStorage.removeItem(likedKey);
      } catch {
        // Roll back on failure
        setLiked(true);
        setLikes((prev) => prev + 1);
        toast.error("Couldn't remove your like. Try again.");
      } finally {
        setLiking(false);
      }
      return;
    }

    // Not liked yet - add like
    setLiked(true);
    setLikes((prev) => prev + 1);
    setLiking(true);

    try {
      const res = await fetch(`/api/videos/${videoId}/like`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { likes: number };
      setLikes(data.likes);
      sessionStorage.setItem(likedKey, "1");
    } catch {
      // Roll back on failure
      setLiked(false);
      setLikes((prev) => prev - 1);
      toast.error("Couldn't register your like. Try again.");
    } finally {
      setLiking(false);
    }
  };

  const copyShareLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    toast.success("Watch link copied");
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleLike}
        className={cn("gap-1.5 px-3 transition-colors")}
      >
        <ThumbsUp className="h-3.5 w-3.5 transition-transform" />
        <span>{formatCount(likes)}</span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 px-3"
        onClick={copyShareLink}
      >
        <Share2 className="h-3.5 w-3.5" />
        Share
      </Button>
    </div>
  );
}
