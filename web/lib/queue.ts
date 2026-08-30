import { Redis } from "@upstash/redis";

export const QUEUE = "video-queue";

export type QueueJob = {
  name: string;
  ext: string;
  resolutions?: string[];
  attempts?: number;
};

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Upstash Redis is not configured");
  }

  return new Redis({ url, token });
}

export async function publishJob(job: QueueJob) {
  const redis = getRedis();
  await (redis as any).lpush(QUEUE, JSON.stringify(job));
}
