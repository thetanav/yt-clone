"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { CheckCircle2, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { MAX_FILE_SIZE } from "@/lib/limits";

const VIDEO_EXTENSIONS = ["mp4", "mov", "avi", "mkv", "webm"] as const;
type VideoExtension = (typeof VIDEO_EXTENSIONS)[number];

const CONTENT_TYPES: Record<VideoExtension, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  webm: "video/webm",
};

export interface UploadedFile {
  name: string;
  size: number;
  key: string;
  extension: VideoExtension;
}

type UploadViewProps = {
  id: string;
  file: UploadedFile | null;
  title: string;
  onFileChange: (file: UploadedFile | null) => void;
  onExtensionChange: (extension: VideoExtension | null) => void;
  onTitleChange: (title: string) => void;
};

function stripExtension(name: string) {
  return name.replace(/\.[^/.]+$/, "");
}

function getExtension(file: File) {
  return file.name.split(".").pop()?.toLowerCase() as VideoExtension | undefined;
}

async function readErrorMessage(response: Response) {
  const payload = await response.json().catch(() => null);
  return (
    payload?.error ??
    payload?.message ??
    `Upload request failed with status ${response.status}`
  );
}

export const UploadView = ({
  id,
  file,
  title,
  onFileChange,
  onExtensionChange,
  onTitleChange,
}: UploadViewProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      fetchAbortRef.current?.abort();
      xhrRef.current?.abort();
    };
  }, []);

  const resetSelection = () => {
    fetchAbortRef.current?.abort();
    xhrRef.current?.abort();
    fetchAbortRef.current = null;
    xhrRef.current = null;
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    setUploading(false);
    setProgress(0);
    setSelectedName(null);
    onFileChange(null);
    onExtensionChange(null);
  };

  const uploadFile = async (pickedFile: File) => {
    const extension = getExtension(pickedFile);

    if (!extension || !VIDEO_EXTENSIONS.includes(extension)) {
      toast.error("Only MP4, MOV, AVI, MKV, and WebM files are supported.");
      return;
    }

    if (!pickedFile.type.startsWith("video/")) {
      toast.error("Please choose a video file.");
      return;
    }

    if (pickedFile.size > MAX_FILE_SIZE) {
      toast.error("File exceeds the 2GB upload limit.");
      return;
    }

    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    setUploading(true);
    setProgress(0);
    setSelectedName(pickedFile.name);

    try {
      const presignResponse = await fetch(
        `/api/upload/p/${id}?extension=${encodeURIComponent(extension)}&size=${pickedFile.size}`,
        {
          method: "GET",
          credentials: "include",
          signal: controller.signal,
        },
      );

      if (!presignResponse.ok) {
        throw new Error(await readErrorMessage(presignResponse));
      }

      const { putUrl, key } = (await presignResponse.json()) as {
        putUrl: string;
        key: string;
      };

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.open("PUT", putUrl);
        xhr.setRequestHeader("Content-Type", CONTENT_TYPES[extension]);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
            return;
          }

          reject(
            new Error(
              `Upload failed with status ${xhr.status}${xhr.responseText ? `: ${xhr.responseText}` : ""}`,
            ),
          );
        };
        xhr.onerror = () => reject(new Error("Network error while uploading"));
        xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
        controller.signal.addEventListener(
          "abort",
          () => {
            xhr.abort();
          },
          { once: true },
        );
        xhr.send(pickedFile);
      });

      const uploadedFile: UploadedFile = {
        name: pickedFile.name,
        size: pickedFile.size,
        key,
        extension,
      };

      onExtensionChange(extension);
      onFileChange(uploadedFile);
      if (!title.trim()) {
        onTitleChange(stripExtension(pickedFile.name));
      }

      toast.success("Video uploaded to S3");
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        const message =
          error instanceof Error ? error.message : "Failed to upload video";
        toast.error(message);
      }
      resetSelection();
    } finally {
      setUploading(false);
      setProgress(0);
      fetchAbortRef.current = null;
      xhrRef.current = null;
    }
  };

  const handleFiles = (files: FileList | null) => {
    const pickedFile = files?.[0];
    if (!pickedFile) return;
    void uploadFile(pickedFile);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  };

  return (
    <div
      className={`rounded-lg border border-dashed p-6 transition-all duration-150 ${
        dragActive
          ? "border-foreground/40 bg-muted/25"
          : "border-border hover:border-foreground/20 hover:bg-muted/15"
      }`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragActive(false);
      }}
      onDrop={handleDrop}>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,.mp4,.mov,.avi,.mkv,.webm"
        className="hidden"
        onChange={(event) => handleFiles(event.target.files)}
      />

      {file ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/25 p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted/40 text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">
                {file.name}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {file.extension} - {(file.size / (1024 * 1024)).toFixed(2)} mb
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={resetSelection}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="flex w-full flex-col items-center justify-center text-center"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}>
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/40 text-foreground/80">
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
          </div>
          <p className="mb-2 text-xs font-semibold text-foreground">
            Click to upload or drag and drop
          </p>
          <p className="text-[11px] text-muted-foreground">
            Video files only: MP4, MOV, AVI, MKV, WebM
          </p>
          {uploading ? (
            <div className="mt-4 w-full max-w-sm">
              <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>{selectedName ?? "Uploading"}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null}
        </button>
      )}
    </div>
  );
};
