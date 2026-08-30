"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Crown,
  Loader2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { toast } from "sonner";

import PageShell from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UploadView, type UploadedFile } from "./upload-view";

interface QuotaResponse {
  plan: "free" | "plus";
  limit: number;
  uploads: number;
  cycleStart: string;
}

const RESOLUTIONS = ["240p", "480p", "720p", "1080p"] as const;

export default function Page() {
  const router = useRouter();
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [title, setTitle] = useState("");
  const [extension, setExtension] = useState<UploadedFile["extension"] | null>(
    null,
  );
  const [description, setDescription] = useState("");
  const [resolutions, setResolutions] = useState<string[]>([...RESOLUTIONS]);
  const [id] = useState(() => nanoid(16));

  const quotaQuery = useQuery<QuotaResponse>({
    queryKey: ["upload-quota"],
    queryFn: async () => {
      const res = await fetch("/api/quota", {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("Failed to load quota");
      }

      return res.json();
    },
  });

  const quota = quotaQuery.data;
  const isQuotaLocked = quota ? quota.uploads >= quota.limit : false;
  const canUpload = Boolean(quota) && !isQuotaLocked;
  const resetAt = quota
    ? new Date(new Date(quota.cycleStart).getTime() + 30 * 24 * 60 * 60 * 1000)
    : null;
  const resetLabel = resetAt
    ? resetAt.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const {
    mutate: uploadVideo,
    isPending,
    isSuccess,
  } = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/upload", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          id,
          extension,
          s3Key: file?.key,
          resolutions,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        toast.error(payload?.error ?? "Upload failed");
        return null;
      }

      toast.success("Video saved and queued for processing");
      setTimeout(() => {
        router.push("/home");
      }, 1500);
      return { success: true };
    },
  });

  return (
    <main>
      <PageShell title="Upload" description="Add a new video">
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold tracking-tight text-foreground">
                  <Crown className="h-4 w-4" />
                  {quotaQuery.isLoading
                    ? "Loading plan details"
                    : quota?.plan === "plus"
                      ? "Plus plan"
                      : "Free plan"}
                  <p className="text-xs text-muted-foreground">
                    {quotaQuery.isLoading
                      ? "Checking your current monthly upload allowance."
                      : quota
                        ? `You have used ${quota.uploads}/${quota.limit} uploads this month.`
                        : "Your monthly quota could not be loaded."}
                  </p>
                </div>
                {/* {quota ? (
                  <p className="text-xs text-muted-foreground">
                    {resetLabel
                      ? `Current cycle started ${new Date(
                          quota.cycleStart,
                        ).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })} and resets on ${resetLabel}.`
                      : `Current cycle started ${new Date(quota.cycleStart).toLocaleDateString()}.`}
                  </p>
                ) : null} */}
              </div>
              {!quotaQuery.isLoading && quota?.plan === "free" ? (
                <Button render={<Link href="/api/billing/checkout" />} size="sm" variant="outline" nativeButton={false}>
                  Upgrade to Plus
                </Button>
              ) : null}
            </div>
            {isQuotaLocked ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">Monthly upload limit reached</p>
                  <p>
                    Free accounts can upload 3 videos per month. Plus accounts
                    can upload 10. Upgrade to continue this month.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <h2 className="text-base font-semibold tracking-tight">
            Video details
          </h2>

          <div className="space-y-1">
            <Label htmlFor="title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              value={title}
              maxLength={120}
              placeholder="A great title (required)"
              onChange={(e) => setTitle(e.target.value)}
              className="h-11"
            />
            <div className="text-right text-xs text-muted-foreground">
              {title.trim().length} / 120 characters
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              placeholder="Tell viewers what this video is about..."
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold tracking-tight text-foreground">
              Renditions
            </Label>
            <div className="flex flex-wrap gap-2">
              {RESOLUTIONS.map((res) => {
                const checked = resolutions.includes(res);
                return (
                  <button
                    key={res}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() =>
                      setResolutions((prev) =>
                        checked
                          ? prev.filter((r) => r !== res)
                          : [...prev, res].sort(
                              (a, b) =>
                                parseInt(a) - parseInt(b),
                            ),
                      )
                    }
                    className={`h-9 rounded-md border px-3 text-xs font-medium transition-colors ${
                      checked
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-muted/20 text-muted-foreground hover:border-foreground/30"
                    }`}>
                    {res}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Choose the output qualities for this video. Fewer renditions
              transcode faster.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold tracking-tight text-foreground">
              Video File <span className="text-destructive">*</span>
            </Label>
            {quotaQuery.isLoading ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/15 p-8 text-center">
                <p className="text-xs font-semibold text-foreground">
                  Loading upload allowance...
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  File upload will unlock once your quota is known.
                </p>
              </div>
            ) : quotaQuery.isError ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/15 p-8 text-center">
                <p className="text-xs font-semibold text-foreground">
                  Unable to load upload allowance
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Refresh the page to try again. Uploads stay locked until quota
                  data is available.
                </p>
              </div>
            ) : isQuotaLocked ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/15 p-8 text-center">
                <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-foreground/80">
                  <Crown className="h-4 w-4" />
                </div>
                <p className="mb-2 text-xs font-semibold text-foreground">
                  Uploads are paused until you upgrade
                </p>
                <p className="mb-4 text-xs text-muted-foreground">
                  Your free monthly quota is exhausted. Plus raises the cap to
                  10 uploads per month.
                </p>
                {resetLabel ? (
                  <p className="mb-4 text-xs text-muted-foreground">
                    This cycle resets on {resetLabel}.
                  </p>
                ) : null}
                <Button render={<Link href="/api/billing/checkout" />} size="sm" variant="outline" nativeButton={false}>
                  Go Plus
                </Button>
              </div>
            ) : (
              <UploadView
                id={id}
                file={file}
                title={title}
                onFileChange={setFile}
                onExtensionChange={setExtension}
                onTitleChange={setTitle}
              />
            )}
          </div>

          <div className="pt-4">
            <Button
              disabled={
                !file ||
                !title.trim() ||
                resolutions.length === 0 ||
                isPending ||
                isSuccess ||
                !canUpload ||
                quotaQuery.isLoading
              }
              size="default"
              className="h-10 w-full gap-2"
              onClick={() => uploadVideo()}>
              {isSuccess ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Upload Complete
                </>
              ) : isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Upload Video
                </>
              )}
            </Button>
          </div>
        </div>
      </PageShell>
    </main>
  );
}
