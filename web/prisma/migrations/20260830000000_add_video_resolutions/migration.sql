-- Per-video transcoding resolution presets (defaults to all four renditions)
ALTER TABLE "Video" ADD COLUMN "resolutions" TEXT[] NOT NULL DEFAULT ARRAY['240p','480p','720p','1080p'];