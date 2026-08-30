import { Hono } from "hono";

import db from "@/lib/db";
import { getPlaybackUrl } from "@/lib/video-urls";
import { authMiddleware } from "@/lib/hono-auth";
import type { AuthVariables } from "@/lib/hono-auth";

const videoActions = new Hono<{ Variables: AuthVariables }>();

videoActions.use("*", authMiddleware);

videoActions.post("/:id/like", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");

  const likes = await db.$transaction(async (tx) => {
    const existing = await tx.like.findUnique({
      where: { userId_videoId: { userId: user.id, videoId: id } },
    });

    if (existing) {
      return (
        (await tx.video.findUnique({
          where: { id },
          select: { likes: true },
        }))?.likes ?? 0
      );
    }

    const video = await tx.video.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!video) return null;

    await tx.like.create({ data: { userId: user.id, videoId: id } });
    const updated = await tx.video.update({
      where: { id },
      data: { likes: { increment: 1 } },
      select: { likes: true },
    });

    return updated.likes;
  });

  if (likes === null) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({ likes });
});

videoActions.delete("/:id/like", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");

  const likes = await db.$transaction(async (tx) => {
    const video = await tx.video.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!video) return null;

    const removed = await tx.like.deleteMany({
      where: { userId: user.id, videoId: id },
    });

    if (removed.count > 0) {
      const updated = await tx.video.update({
        where: { id },
        data: { likes: { decrement: 1 } },
        select: { likes: true },
      });
      return updated.likes;
    }

    return (
      (await tx.video.findUnique({
        where: { id },
        select: { likes: true },
      }))?.likes ?? 0
    );
  });

  if (likes === null) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({ likes });
});

videoActions.post("/:id/view", async (c) => {
  const id = c.req.param("id");

  const video = await db.video.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!video) {
    return c.json({ error: "Not found" }, 404);
  }

  await db.video.update({
    where: { id },
    data: { views: { increment: 1 } },
  });

  return c.json({ ok: true });
});

videoActions.get("/:id/share", async (c) => {
  const id = c.req.param("id");

  const video = await db.video.findUnique({
    where: { id },
    select: { id: true, status: true },
  });

  if (!video) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({
    watchUrl: `/w/${id}`,
    streamUrl: video.status === "done" ? getPlaybackUrl(id) : "",
  });
});

export default videoActions;