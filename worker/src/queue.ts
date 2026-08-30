import { Redis } from "@upstash/redis";

export const QUEUE = "video-queue";
export const RETRY_QUEUE = "video-queue:retry";
export const INFLIGHT = "video-queue:inflight";
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 30_000;
export const LEASE_MS = 60 * 60 * 1000;

const redis = Redis.fromEnv();

type RedisLike = {
  eval: (
    script: string,
    keys: string[],
    args: (string | number)[],
  ) => Promise<unknown>;
  zadd: (key: string, member: Record<string, unknown>) => Promise<unknown>;
  zrem: (key: string, member: string) => Promise<unknown>;
  zrange: (key: string, start: string | number, stop: string | number, options?: unknown) => Promise<unknown>;
  lpush: (key: string, value: string) => Promise<unknown>;
};

const $redis = redis as unknown as RedisLike;

export type QueueJob = {
  name: string;
  ext: string;
  resolutions?: string[];
  attempts?: number;
};

const POP_SCRIPT = `
local raw = redis.call('rpop', KEYS[1])
if raw then
  redis.call('zadd', KEYS[2], ARGV[1], raw)
end
return raw
`;

export function parseJob(raw: string | null): QueueJob | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
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
          typeof parsed.attempts === "number" && Number.isFinite(parsed.attempts)
            ? parsed.attempts
            : 0,
      };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Atomically pops a job off the queue and claims it in the inflight set with a
 * lease (score = expiry timestamp). A crashed worker leaves the job in inflight;
 * once the lease expires, `recoverExpiredInflight` re-queues it so nothing is lost.
 */
export async function popJob(): Promise<string | null> {
  const raw = await $redis.eval(POP_SCRIPT, [QUEUE, INFLIGHT], [
    Date.now() + LEASE_MS,
  ]);
  return typeof raw === "string" ? raw : null;
}

/** Releases a job claim (success or terminal failure). */
export async function completeJob(raw: string) {
  await $redis.zrem(INFLIGHT, raw);
}

/** Heartbeat: extends the lease for a job still being processed. */
export async function touchJob(raw: string) {
  await $redis.zadd(INFLIGHT, {
    score: Date.now() + LEASE_MS,
    member: raw,
  });
}

export async function scheduleRetry(job: QueueJob) {
  await $redis.zadd(RETRY_QUEUE, {
    score: Date.now() + RETRY_DELAY_MS,
    member: JSON.stringify(job),
  });
}

function extractDueMembers(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  if (typeof raw[0] === "string") {
    if (raw.length % 2 === 0) {
      const members: string[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        members.push(raw[i]);
      }
      return members;
    }

    return raw as string[];
  }

  if (Array.isArray(raw[0])) {
    return raw
      .map((item) => item[0])
      .filter((item): item is string => typeof item === "string");
  }

  if (typeof raw[0] === "object" && raw[0] !== null && "member" in raw[0]) {
    return raw
      .map((item) => (item as { member?: unknown }).member)
      .filter((item): item is string => typeof item === "string");
  }

  return [];
}

async function requeueDueMembers(setKey: string, limit: number) {
  const due = await $redis.zrange(setKey, "-inf", Date.now(), {
    byScore: true,
    withScores: true,
    count: limit,
    offset: 0,
  });

  const members = extractDueMembers(due);
  for (const member of members) {
    const removed = await $redis.zrem(setKey, member);
    if (removed) {
      await $redis.lpush(QUEUE, member);
    }
  }

  return members.length;
}

/** Re-queues delayed retry jobs whose wait time has elapsed. */
export async function drainDueRetries(limit = 25) {
  await requeueDueMembers(RETRY_QUEUE, limit);
}

/** Re-queues inflight jobs whose lease expired (e.g. crashed workers). */
export async function recoverExpiredInflight(limit = 25) {
  await requeueDueMembers(INFLIGHT, limit);
}