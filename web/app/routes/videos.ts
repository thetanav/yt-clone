import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import db from "@/lib/db";
import { redis } from "@/lib/redis";
import { deleteRawVideo, deleteVideoAssets } from "@/lib/r2";
import { authMiddleware, requireAuth } from "@/lib/hono-auth";
import type { AuthVariables } from "@/lib/hono-auth";

const videos = new Hono<{ Variables: AuthVariables }>();

videos.use("*", authMiddleware);
videos.use("*", requireAuth);

videos.get("/", async (c) => {
  const user = c.get("user")!;

  const statusParam = c.req.query("status");
  const statuses = statusParam
    ? statusParam.split(",").map((v) => v.trim()).filter(Boolean)
    : [];

  const where = {
    userId: user.id,
    ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
  };

  const videos = await db.video.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  return c.json(videos, {
    headers: { "Cache-Control": "private, no-store" },
  });
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(10_000).optional(),
});

videos.patch(
  "/:id",
  zValidator("json", updateSchema),
  async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const video = await db.video.findFirst({
      where: { id, userId: user.id },
    });

    if (!video) {
      return c.json({ error: "Not found" }, 404);
    }

    if (!body.title && body.description === undefined) {
      return c.json({ error: "No changes provided" }, 400);
    }

    const updated = await db.video.update({
      where: { id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      },
    });

    return c.json(updated);
  },
);

videos.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");

  const video = await db.video.findFirst({
    where: { id, userId: user.id },
  });

  if (!video) {
    return c.json({ error: "Not found" }, 404);
  }

  await db.video.delete({ where: { id } });
  await redis.del(`status:${id}`);
  await deleteVideoAssets(id);
  await deleteRawVideo(video.s3Key);

  return c.json({ ok: true });
});

export default videos;
