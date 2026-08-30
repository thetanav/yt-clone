import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import db from "@/lib/db";
import { publishJob } from "@/lib/queue";
import { deleteRawVideo } from "@/lib/r2";
import { authMiddleware, requireAuth } from "@/lib/hono-auth";
import type { AuthVariables } from "@/lib/hono-auth";

const upload = new Hono<{ Variables: AuthVariables }>();

upload.use("*", authMiddleware);
upload.use("*", requireAuth);

const RESOLUTIONS = ["240p", "480p", "720p", "1080p"] as const;

const uploadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(10_000).optional().default(""),
  id: z.string().trim().min(1),
  extension: z.enum(["mp4", "mov", "avi", "mkv", "webm"]),
  s3Key: z.string().trim().min(1),
  thumbnailUrl: z.string().url().optional().nullable(),
  resolutions: z
    .array(z.enum(RESOLUTIONS))
    .min(1)
    .max(RESOLUTIONS.length)
    .default([...RESOLUTIONS]),
});

upload.post(
  "/",
  zValidator("json", uploadSchema),
  async (c) => {
    const user = c.get("user")!;
    const body = c.req.valid("json");
    const { title, description, id, extension, s3Key, resolutions } = body;

    let quotaRejected:
      | { plan: string; limit: number; used: number }
      | undefined;

    try {
      await db.$transaction(async (tx) => {
        const dbUser = await tx.user.findUnique({
          where: { id: user.id },
          select: {
            plan: true,
            monthlyUploadCount: true,
            uploadWindowStart: true,
          },
        });

        if (!dbUser) {
          throw new Error("User not found");
        }

        const current = new Date();
        const userLimits = dbUser.plan == "plus" ? 10 : 3;

        const cycleStart = new Date(dbUser.uploadWindowStart);
        const quotaWindowMs = 30 * 24 * 60 * 60 * 1000;
        const windowExpired = current.getTime() - cycleStart.getTime() >= quotaWindowMs;

        if (windowExpired) {
          await tx.user.update({
            where: { id: user.id },
            data: {
              uploadWindowStart: current,
              monthlyUploadCount: 1,
            },
          });
        } else {
          const claimed = await tx.user.updateMany({
            where: {
              id: user.id,
              monthlyUploadCount: { lt: userLimits },
            },
            data: {
              monthlyUploadCount: { increment: 1 },
            },
          });

          if (claimed.count === 0) {
            quotaRejected = {
              plan: dbUser.plan,
              limit: userLimits,
              used: dbUser.monthlyUploadCount,
            };
            return;
          }
        }

        await tx.video.create({
          data: {
            id,
            title,
            description,
            s3Key,
            resolutions,
            likes: 0,
            userId: user.id,
          },
        });
      });
    } catch (error) {
      console.error("Failed to create video record:", error);
      await deleteRawVideo(s3Key);
      return c.json({ error: "Failed to create video record" }, 500);
    }

    if (quotaRejected) {
      await deleteRawVideo(s3Key);
      return c.json(
        { error: "Monthly upload limit reached", ...quotaRejected },
        429,
      );
    }

    try {
      await publishJob({ name: id, ext: extension, resolutions });
    } catch (error) {
      console.error("Queue publish error:", error);

      await db.video.update({
        where: { id },
        data: { status: "failed" },
      });

      await deleteRawVideo(body.s3Key);

      return c.json(
        { error: "Upload saved, but transcoding could not be queued" },
        503,
      );
    }

    return c.text("ok");
  },
);

export default upload;
