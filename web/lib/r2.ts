import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

import S3 from "./s3";

export const R2_BUCKET = process.env.R2_BUCKET ?? "yux-videos";

export async function deleteRawVideo(s3Key?: string | null) {
  const key = s3Key?.trim();
  if (!key || !key.startsWith("raw_videos/")) return;

  try {
    await S3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (error) {
    console.error(`Failed to delete raw video from R2 (${key}):`, error);
  }
}

export async function deleteVideoAssets(id: string) {
  try {
    const keys = await listObjects({ prefix: `${id}/` });
    await deleteObjects(keys);
  } catch (error) {
    console.error(`Failed to delete video assets for ${id}:`, error);
  }
}

async function listObjects({ prefix }: { prefix: string }): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const res = await S3.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );

    for (const object of res.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    token = res.NextContinuationToken;
  } while (token);

  return keys;
}

async function deleteObjects(keys: string[]) {
  if (keys.length === 0) return;

  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    await S3.send(
      new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: batch },
      }),
    );
  }
}