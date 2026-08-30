import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import axios from "axios";
import { pipeline } from "stream/promises";
import {
  MAX_RETRIES,
  completeJob,
  drainDueRetries,
  popJob,
  recoverExpiredInflight,
  scheduleRetry,
  touchJob,
} from "./queue.js";

dotenv.config();

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const RAW_PREFIX = "raw_videos/";
const tmpDir = "tmp";
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

class PermanentlyFailedError extends Error {}

interface Resolution {
  name: string;
  height: number;
  bitrate: string;
}

const resolutions: Resolution[] = [
  { name: "240p", height: 240, bitrate: "400k" },
  { name: "480p", height: 480, bitrate: "800k" },
  { name: "720p", height: 720, bitrate: "1400k" },
  { name: "1080p", height: 1080, bitrate: "2800k" },
];

function getVideoDimensions(inputPath: string): { width: number; height: number } | null {
  try {
    const result = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${inputPath}"`,
      { encoding: "utf-8" },
    ).trim();
    const [width, height] = result.split("x").map((v) => parseInt(v));
    if (width && height) return { width, height };
  } catch {
    // fall back to placeholder dimensions below
  }
  return null;
}

async function encodeResolution(
  inputPath: string,
  outputDir: string,
  resolution: Resolution,
) {
  return new Promise<void>((resolve, reject) => {
    const playlistPath = path.join(outputDir, `${resolution.name}.m3u8`);
    const segmentPattern = path.join(outputDir, `${resolution.name}_%03d.ts`);

    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vf",
      `scale=-2:${resolution.height}`,
      "-c:v",
      "libx264",
      "-b:v",
      resolution.bitrate,
      "-maxrate",
      resolution.bitrate,
      "-bufsize",
      `${parseInt(resolution.bitrate) * 2}k`,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-hls_time",
      "10",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      segmentPattern,
      "-start_number",
      "0",
      playlistPath,
    ]);

    ffmpeg.on("error", (err) => reject(new Error(`ffmpeg exited with error: ${err}`)));
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

async function generateThumbnail(inputPath: string, outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vf",
      "select=eq(n\\,0)",
      "-q:v",
      "3",
      "-frames:v",
      "1",
      outputPath,
    ]);

    ffmpeg.on("error", (err) => reject(new Error(`ffmpeg thumbnail error: ${err}`)));
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg thumbnail exited with code ${code}`));
    });
  });
}

const SPRITE_THUMB_WIDTH = 160;
const SPRITE_THUMB_INTERVAL = 5;
const SPRITE_COLUMNS = 10;

function getVideoDuration(inputPath: string): number {
  const result = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`,
    { encoding: "utf-8" },
  ).trim();
  return parseFloat(result);
}

async function generateThumbnailSprites(
  inputPath: string,
  outputDir: string,
): Promise<{ vttPath: string; spritePaths: string[] }> {
  const duration = getVideoDuration(inputPath);
  const totalFrames = Math.ceil(duration / SPRITE_THUMB_INTERVAL);
  const rows = Math.ceil(totalFrames / SPRITE_COLUMNS);
  const thumbHeight = Math.round(SPRITE_THUMB_WIDTH * (9 / 16));

  console.log(
    `> Generating ${totalFrames} thumbnails (${SPRITE_COLUMNS}x${rows} grid, ${SPRITE_THUMB_WIDTH}x${thumbHeight}px each)...`,
  );

  const spriteDir = path.join(outputDir, "sprites");
  fs.mkdirSync(spriteDir, { recursive: true });

  const spritePaths: string[] = [];

  for (let sheetIndex = 0; sheetIndex < rows; sheetIndex++) {
    const spriteFile = `sprite_${String(sheetIndex).padStart(3, "0")}.jpg`;
    const spritePath = path.join(spriteDir, spriteFile);

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-y",
        "-i",
        inputPath,
        "-vf",
        `fps=1/${SPRITE_THUMB_INTERVAL},scale=${SPRITE_THUMB_WIDTH}:${thumbHeight}:force_original_aspect_ratio=decrease,pad=${SPRITE_THUMB_WIDTH}:${thumbHeight}:(ow-iw)/2:(oh-ih)/2,tile=${SPRITE_COLUMNS}x1`,
        "-q:v",
        "5",
        "-frames:v",
        "1",
        spritePath,
      ]);

      ffmpeg.on("error", (err) => reject(new Error(`ffmpeg sprite error: ${err}`)));
      ffmpeg.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg sprite exited with code ${code}`));
      });
    });

    spritePaths.push(spritePath);
  }

  const vttLines = ["WEBVTT", ""];
  for (let i = 0; i < totalFrames; i++) {
    const sheetIndex = Math.floor(i / SPRITE_COLUMNS);
    const col = i % SPRITE_COLUMNS;
    const startTime = i * SPRITE_THUMB_INTERVAL;
    const endTime = Math.min(startTime + SPRITE_THUMB_INTERVAL, duration);

    const startStr = formatVttTime(startTime);
    const endStr = formatVttTime(endTime);
    const x = col * SPRITE_THUMB_WIDTH;
    const spriteFile = `sprite_${String(sheetIndex).padStart(3, "0")}.jpg`;

    vttLines.push(`${startStr} --> ${endStr}`);
    vttLines.push(`${spriteFile}#xywh=${x},0,${SPRITE_THUMB_WIDTH},${thumbHeight}`);
    vttLines.push("");
  }

  const vttPath = path.join(outputDir, "thumbnails.vtt");
  fs.writeFileSync(vttPath, vttLines.join("\n"));

  return { vttPath, spritePaths };
}

function formatVttTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "." +
    String(ms).padStart(3, "0")
  );
}

function createMasterPlaylist(outputDir: string, targets: Resolution[]) {
  const masterPath = path.join(outputDir, "index.m3u8");
  let content = "#EXTM3U\n#EXT-X-VERSION:3\n";

  targets.forEach((res) => {
    const playlistPath = path.join(outputDir, `${res.name}.m3u8`);
    const dimensions =
      getVideoDimensions(playlistPath) ?? { width: 1920, height: res.height };
    const bandwidth = parseInt(res.bitrate) * 1000;
    content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${dimensions.width}x${dimensions.height}\n`;
    content += `${res.name}.m3u8\n`;
  });

  fs.writeFileSync(masterPath, content);
}

async function downloadFromR2(key: string, outPath: string): Promise<number> {
  console.log(`> Downloading raw video from R2 (${key})...`);

  const tempPath = `${outPath}.tmp`;

  let response;
  try {
    response = await r2.send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET ?? "yux-videos", Key: key }),
    );
  } catch (err: any) {
    throw new Error(`R2 download request failed: ${err.message}`);
  }

  if (!response.Body) {
    throw new Error("R2 download failed: empty body");
  }

  try {
    await pipeline(
      response.Body as NodeJS.ReadableStream,
      fs.createWriteStream(tempPath),
    );
  } catch (err: any) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw new Error(`Stream write failed: ${err.message}`);
  }

  if (!fs.existsSync(tempPath)) {
    throw new Error("Download failed: file not created");
  }

  const stats = fs.statSync(tempPath);
  if (stats.size === 0) {
    fs.unlinkSync(tempPath);
    throw new Error("Downloaded file is empty");
  }

  fs.renameSync(tempPath, outPath);
  console.log(`> Downloaded raw video ${stats.size} bytes to ${outPath}`);
  return stats.size;
}

async function deleteFromR2(key: string, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await r2.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET ?? "yux-videos",
          Key: key,
        }),
      );
      console.log(`> Deleted raw video from R2 (${key})`);
      return;
    } catch (error) {
      console.error(`Delete attempt ${attempt}/${retries} failed for ${key}:`, error);
      if (attempt === retries) {
        throw new Error(`Failed to delete ${key} after ${retries} attempts`);
      }
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
  }
}

async function uploadToR2(
  filePath: string,
  key: string,
  contentType: string,
  retries = 3,
) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const fileStream = fs.createReadStream(filePath);
      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET ?? "yux-videos",
          Key: key,
          Body: fileStream,
          ContentType: contentType,
        }),
      );
      return;
    } catch (error) {
      console.error(`Upload attempt ${attempt}/${retries} failed for ${key}:`, error);
      if (attempt === retries) {
        throw new Error(`Failed to upload ${key} after ${retries} attempts`);
      }
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
  }
}

function cleanup(paths: string[]) {
  console.log("> Cleaning up temporary files...");
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          fs.rmSync(p, { recursive: true });
        } else {
          fs.unlinkSync(p);
        }
      }
    } catch (err) {
      console.error(`Cleanup failed for ${p}:`, err);
    }
  }
}

interface Job {
  name: string;
  ext: string;
  resolutions?: string[];
  attempts?: number;
}

async function reportStatus(
  jobId: string,
  status: JobStatus,
  progress?: number,
): Promise<boolean> {
  const nextProgress =
    progress ?? (status === "done" ? 100 : status === "pending" ? 0 : undefined);

  const headers = process.env.WORKER_SHARED_SECRET
    ? { "x-worker-secret": process.env.WORKER_SHARED_SECRET }
    : undefined;

  // Terminal states are acknowledged back by the web app; retry harder so a
  // transient outage can't strand a video in "processing" forever.
  const attempts = status === "done" || status === "failed" ? 10 : 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await axios.post(
        `${process.env.BACKEND_URL}/api/status/${jobId}`,
        { status, progress: nextProgress },
        headers ? { headers } : undefined,
      );
      return true;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  console.error(
    `> Failed to report status ${status} for ${jobId} after ${attempts} attempts:`,
    lastError,
  );
  return false;
}

type JobStatus = "pending" | "processing" | "done" | "failed";

function parseJob(raw: string): Job | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "name" in parsed &&
      "ext" in parsed &&
      typeof parsed.name === "string" &&
      typeof parsed.ext === "string"
    ) {
      return {
        name: parsed.name,
        ext: parsed.ext,
        resolutions:
          Array.isArray(parsed.resolutions) &&
          parsed.resolutions.every((r: unknown) => typeof r === "string")
            ? parsed.resolutions
            : undefined,
        attempts:
          typeof (parsed as { attempts?: unknown }).attempts === "number" &&
          Number.isFinite((parsed as { attempts?: number }).attempts ?? NaN)
            ? (parsed as { attempts: number }).attempts
            : 0,
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function processJob(job: Job, raw: string) {
  const { name, ext } = job;

  const rawKey = `${RAW_PREFIX}${name}.${ext}`;
  const inputPath = path.join(tmpDir, `${name}.${ext}`);
  const outputDir = path.join(tmpDir, name);
  const thumbnailPath = path.join(tmpDir, `${name}_thumb.jpg`);

  const requested = job.resolutions?.length
    ? job.resolutions.filter((r) => resolutions.some((x) => x.name === r))
    : resolutions.map((x) => x.name);
  const targets =
    resolutions.filter((x) => requested.includes(x.name)).length > 0
      ? resolutions.filter((x) => requested.includes(x.name))
      : resolutions;

  console.log(`> Renditions to encode: ${targets.map((t) => t.name).join(", ")}`);

  try {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const downloadedSize = await downloadFromR2(rawKey, inputPath);
    if (downloadedSize > MAX_FILE_SIZE) {
      throw new PermanentlyFailedError(
        `Raw video exceeds the ${Math.round(MAX_FILE_SIZE / 1e9)}GB size limit`,
      );
    }
    await touchJob(raw);
    await reportStatus(name, "processing", 10);

    console.log("> Generating thumbnail...");
    await generateThumbnail(inputPath, thumbnailPath);
    await reportStatus(name, "processing", 15);

    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const stride = Math.round(60 / targets.length);
    for (let i = 0; i < targets.length; i++) {
      const resolution = targets[i]!;
      console.log(`> Encoding ${resolution.name}...`);
      await encodeResolution(inputPath, outputDir, resolution);
      await reportStatus(name, "processing", Math.min(75, 15 + (i + 1) * stride));
    }

    createMasterPlaylist(outputDir, targets);
    await reportStatus(name, "processing", 78);

    console.log("> Generating thumbnail sprites...");
    const { vttPath, spritePaths } = await generateThumbnailSprites(
      inputPath,
      outputDir,
    );
    await touchJob(raw);
    await reportStatus(name, "processing", 85);

    fs.unlinkSync(inputPath);

    console.log("> Uploading to R2...");
    try {
      const files = fs
        .readdirSync(outputDir)
        .filter((f) => !f.startsWith("sprites"));
      for (const file of files) {
        const filePath = path.join(outputDir, file);
        const contentType = file.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : file.endsWith(".vtt")
            ? "text/vtt"
            : "video/mp2t";

        await uploadToR2(filePath, `${name}/${file}`, contentType);
      }

      for (const spritePath of spritePaths) {
        const spriteFile = path.basename(spritePath);
        await uploadToR2(spritePath, `${name}/sprites/${spriteFile}`, "image/jpeg");
      }

      await uploadToR2(thumbnailPath, `${name}/thumb.jpg`, "image/jpeg");

      fs.unlinkSync(thumbnailPath);
      fs.rmSync(outputDir, { recursive: true });

      const doneReported = await reportStatus(name, "done", 100);
      if (!doneReported) {
        throw new Error(
          "Completion could not be confirmed with the web app; keeping raw for retry",
        );
      }
      await deleteFromR2(rawKey);
    } catch (error) {
      console.error(`Error uploading to R2:`, error);
      throw error;
    }
  } catch (error) {
    console.error(`Error processing ${name}:`, error);
    const spriteDir = path.join(outputDir, "sprites");
    cleanup([inputPath, outputDir, thumbnailPath, spriteDir]);
    throw error;
  }
}

async function startWorker() {
  console.log("Worker waiting for jobs...");

  while (true) {
    await drainDueRetries();
    await recoverExpiredInflight();

    const raw = await popJob();
    if (!raw) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    const job = parseJob(raw);
    if (!job) {
      console.error("> Skipping unparseable job:", raw);
      await completeJob(raw);
      continue;
    }

    console.log("Received:", job.name);

    try {
      await processJob(job, raw);
      await completeJob(raw);
      console.log("Job processed:", job.name);
    } catch (err) {
      await completeJob(raw);

      if (err instanceof PermanentlyFailedError) {
        console.error(
          `Job ${job.name} permanently failed: ${err.message}`,
        );
        await reportStatus(job.name, "failed");
        continue;
      }

      const attempts = job.attempts ?? 0;
      console.error(
        `Job ${job.name} failed (attempt ${attempts + 1}/${MAX_RETRIES}):`,
        err,
      );

      if (attempts < MAX_RETRIES) {
        await scheduleRetry({ ...job, attempts: attempts + 1 });
      } else {
        await reportStatus(job.name, "failed");
        console.error(`Job ${job.name} exhausted retries.`);
      }
    }
  }
}

startWorker();
