"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  getPlaybackUrl,
  getThumbnailUrl,
  getThumbnailVttUrl,
} from "@/lib/video-urls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createPlayer, Thumbnail } from "@videojs/react";
import { MinimalVideoSkin, Video, videoFeatures } from "@videojs/react/video";
import "@videojs/react/video/minimal-skin.css";

const Player = createPlayer({ features: videoFeatures });

const qualityOptions = [
  { label: "Auto", value: "auto", fileName: "index.m3u8" },
  { label: "1080p", value: "1080p", fileName: "1080p.m3u8" },
  { label: "720p", value: "720p", fileName: "720p.m3u8" },
  { label: "480p", value: "480p", fileName: "480p.m3u8" },
  { label: "240p", value: "240p", fileName: "240p.m3u8" },
] as const;

type Quality = (typeof qualityOptions)[number]["value"];

type PlaybackState = {
  time: number;
  paused: boolean;
};

function getQualityUrl(
  src: string,
  quality: Quality,
  options: readonly (typeof qualityOptions)[number][],
) {
  const option = options.find((item) => item.value === quality);
  if (!option) return src;

  return src.replace(/[^/]+$/, option.fileName);
}

export const VideoJsPlayer = ({
  id,
  resolutions,
}: {
  id: string;
  resolutions: string[];
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingPlaybackState = useRef<PlaybackState | null>(null);
  const src = getPlaybackUrl(id);

  const availableOptions = useMemo(
    () => qualityOptions.filter((o) => o.value === "auto" || resolutions.includes(o.value)),
    [resolutions],
  );

  const [selectedQuality, setSelectedQuality] = useState<Quality>("auto");
  const [previewTime, setPreviewTime] = useState(0);

  const playbackSrc = useMemo(
    () => (src ? getQualityUrl(src, selectedQuality, availableOptions) : ""),
    [selectedQuality, src, availableOptions],
  );

  const vttUrl = useMemo(() => getThumbnailVttUrl(id), [id]);

  const selectedQualityLabel =
    qualityOptions.find((item) => item.value === selectedQuality)?.label ??
    "Auto";

  useEffect(() => {
    const video = videoRef.current;
    const playbackState = pendingPlaybackState.current;

    if (!video || !playbackState) return;

    const restorePlaybackState = () => {
      video.currentTime = playbackState.time;

      if (!playbackState.paused) {
        void video.play().catch(() => undefined);
      }

      pendingPlaybackState.current = null;
    };

    video.addEventListener("loadedmetadata", restorePlaybackState, {
      once: true,
    });

    return () => {
      video.removeEventListener("loadedmetadata", restorePlaybackState);
    };
  }, [playbackSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setPreviewTime(video.currentTime);
    video.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [playbackSrc]);

  const handleQualityChange = (quality: string) => {
    if (quality === selectedQuality) return;

    const video = videoRef.current;
    if (video) {
      pendingPlaybackState.current = {
        time: video.currentTime,
        paused: video.paused,
      };
    }

    setSelectedQuality(quality as Quality);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <Player.Provider>
        <MinimalVideoSkin
          className="h-full w-full"
          poster={getThumbnailUrl(id)}>
          <Video
            ref={videoRef}
            autoPlay={true}
            className="h-full w-full"
            src={playbackSrc}
            playsInline>
            <track kind="metadata" label="thumbnails" src={vttUrl} default />
          </Video>
          <Thumbnail
            className="pointer-events-none absolute bottom-12 left-3 z-30 max-w-[180px]"
            time={previewTime}
          />
        </MinimalVideoSkin>
      </Player.Provider>

      {src ? (
        <div
          className="absolute right-3 top-3 z-20"
          onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-black/65 px-3 text-xs font-medium text-white shadow-lg ring-1 ring-white/15 backdrop-blur transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  aria-label="Select video quality"
                />
              }>
              <span>{selectedQualityLabel}</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-28">
              <DropdownMenuRadioGroup
                value={selectedQuality}
                onValueChange={handleQualityChange}>
                {availableOptions.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
};
