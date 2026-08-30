import { Hono } from "hono";

import db from "@/lib/db";
import { redis } from "@/lib/redis";
import { deleteRawVideo, deleteVideoAssets } from "@/lib/r2";
import { authMiddleware, requireAuth } from "@/lib/hono-auth";
import type { AuthVariables } from "@/lib/hono-auth";

const deleteRoute = new Hono<{ Variables: AuthVariables }>();

deleteRoute.use("*", authMiddleware);
deleteRoute.use("*", requireAuth);

deleteRoute.post("/", async (c) => {
  const user = c.get("user")!;
  const { id } = await c.req.json<{ id?: string }>();

  if (!id) {
    return c.json({ error: "Missing id" }, 400);
  }

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

export default deleteRoute;
