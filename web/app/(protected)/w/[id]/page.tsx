import WatchClient from "./watch-client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import db from "@/lib/db";
import { notFound } from "next/navigation";
import { ArrowLeft, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { VideoJsPlayer } from "./player";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const video = await db.video.findUnique({ where: { id } });
  if (!video) notFound();

  const user = await db.user.findUnique({ where: { id: video.userId } });

  const timeAgo = formatDistanceToNow(new Date(video.createdAt), {
    addSuffix: true,
  });

  const formatViews = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
  };

  const initials = user?.name
    ? user.name
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : "V";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto flex h-12 items-center px-4 sm:px-6 lg:px-8">
          <Link href="/home">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 -ml-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Player */}
        <div className="relative w-full overflow-hidden rounded-lg border border-border bg-muted/10" style={{ aspectRatio: "16/9" }}>
          {video.status === "done" ? (
            <VideoJsPlayer id={id} resolutions={video.resolutions} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted/40 text-foreground/80">
                <Activity className="h-4 w-4 animate-pulse" />
              </div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Processing video...
              </p>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="mt-6">
          {/* Title */}
          <h1 className="text-lg font-semibold tracking-tight text-foreground leading-snug">
            {video.title}
          </h1>

          {/* Meta row */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
            {/* Author + stats */}
            <div className="flex items-center gap-3">
              {user?.image ? (
                <img
                  src={user.image}
                  alt={user.name ?? "User"}
                  className="h-8 w-8 shrink-0 rounded-full object-cover border border-border"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 text-xs font-semibold text-foreground">
                  {initials}
                </div>
              )}
              <div className="leading-tight">
                <p className="text-xs font-semibold text-foreground">
                  {user?.name ?? "Unknown"}
                </p>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                  {formatViews(video.views ?? 0)} views
                  <span className="mx-1.5 opacity-40">|</span>
                  {timeAgo}
                </p>
              </div>
            </div>

            {/* Actions */}
            <WatchClient
              videoId={id}
              initialLikes={video.likes ?? 0}
            />
          </div>

          {/* Description */}
          {video.description && (
            <div className="mt-6 rounded-lg border border-border bg-muted/10 px-4 py-4">
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {video.description}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
