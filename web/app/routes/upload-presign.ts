import { Hono } from "hono";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

import S3 from "@/lib/s3";
import { R2_BUCKET } from "@/lib/r2";
import { MAX_FILE_SIZE } from "@/lib/limits";
import { authMiddleware, requireAuth } from "@/lib/hono-auth";
import type { AuthVariables } from "@/lib/hono-auth";

const extensionSchema = z.enum(["mp4", "mov", "avi", "mkv", "webm"]);

const CONTENT_TYPES: Record<z.infer<typeof extensionSchema>, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  webm: "video/webm",
};

function parseSize(size: unknown): number | null {
  if (typeof size !== "string" && typeof size !== "number") return null;
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.floor(bytes);
}

async function buildPresignResponse(
  c: any,
  id: string,
  extension: string | null,
  size: number | null,
) {
  const parsedExtension = extensionSchema.safeParse(
    typeof extension === "string" ? extension.toLowerCase() : extension,
  );

  if (!parsedExtension.success) {
    return c.json(
      {
        error: "Missing or invalid extension. Use one of mp4, mov, avi, mkv, or webm.",
      },
      400,
    );
  }

  if (size === null) {
    return c.json({ error: "Missing or invalid file size" }, 400);
  }

  if (size > MAX_FILE_SIZE) {
    return c.json(
      { error: `File exceeds the ${Math.round(MAX_FILE_SIZE / 1e9)}GB limit` },
      413,
    );
  }

  const key = `raw_videos/${id}.${parsedExtension.data}`;
  const contentType = CONTENT_TYPES[parsedExtension.data];
  const putUrl = await getSignedUrl(
    S3,
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 5 * 3600 },
  );

  return c.json({ putUrl, key, contentType });
}

const uploadPresign = new Hono<{ Variables: AuthVariables }>();

uploadPresign.use("*", authMiddleware);
uploadPresign.use("*", requireAuth);

uploadPresign.get("/:id", async (c) => {
  const id = c.req.param("id");
  const extension = c.req.query("extension") ?? null;
  const size = parseSize(c.req.query("size") ?? null);
  return buildPresignResponse(c, id, extension, size);
});

uploadPresign.post("/:id", async (c) => {
  const id = c.req.param("id");

  let extension: string | null = null;
  let size: number | null = null;
  try {
    const body = await c.req.json<{
      extension?: unknown;
      size?: unknown;
    }>();
    if (typeof body.extension === "string") {
      extension = body.extension;
    }
    size = parseSize(body.size ?? null);
  } catch {
    // Ignore malformed bodies
  }

  return buildPresignResponse(c, id, extension, size);
});

export default uploadPresign;