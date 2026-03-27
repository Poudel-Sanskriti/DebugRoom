import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { TraceResult } from "@debugroom/contracts";

export interface Artifacts {
  put(
    attemptId: string,
    result: TraceResult,
  ): Promise<{ key: string; sha256: string; bytes: number }>;
  get(key: string, expectedHash: string): Promise<TraceResult>;
  remove(key: string): Promise<void>;
}
const safeKey = (key: string) => {
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.json$/.test(key))
    throw new Error("Invalid artifact key");
  return key;
};
const encode = (attemptId: string, result: TraceResult) => {
  const key = safeKey(`${attemptId}/${randomUUID()}.json`);
  const body = JSON.stringify(result);
  return {
    key,
    body,
    sha256: createHash("sha256").update(body).digest("hex"),
    bytes: Buffer.byteLength(body),
  };
};
function decode(body: string, expectedHash: string): TraceResult {
  if (createHash("sha256").update(body).digest("hex") !== expectedHash)
    throw new Error("Trace artifact checksum mismatch");
  return JSON.parse(body);
}
export class LocalArtifacts implements Artifacts {
  constructor(public directory: string) {}
  async put(attemptId: string, result: TraceResult) {
    const artifact = encode(attemptId, result),
      destination = path.join(this.directory, artifact.key);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const staging = destination + ".tmp";
    await writeFile(staging, artifact.body, { mode: 0o600, flag: "wx" });
    await rename(staging, destination);
    return {
      key: artifact.key,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    };
  }
  async get(key: string, expectedHash: string) {
    return decode(
      await readFile(path.join(this.directory, safeKey(key)), "utf8"),
      expectedHash,
    );
  }
  async remove(key: string) {
    await unlink(path.join(this.directory, safeKey(key))).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  async sweep(referenced: Set<string>, olderThan = Date.now() - 3600_000) {
    let removed = 0;
    for (const directory of await readdir(this.directory, {
      withFileTypes: true,
    }).catch(() => [])) {
      if (!directory.isDirectory() || !/^[a-f0-9-]{36}$/.test(directory.name))
        continue;
      for (const filename of await readdir(
        path.join(this.directory, directory.name),
      )) {
        const key = `${directory.name}/${filename}`;
        if (
          !/^[a-f0-9-]{36}\.json(?:\.tmp)?$/.test(filename) ||
          referenced.has(key)
        )
          continue;
        if ((await stat(path.join(this.directory, key))).mtimeMs < olderThan) {
          await unlink(path.join(this.directory, key));
          removed++;
        }
      }
    }
    return removed;
  }
}
export class S3Artifacts implements Artifacts {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}
  async put(attemptId: string, result: TraceResult) {
    const artifact = encode(attemptId, result);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: artifact.key,
        Body: artifact.body,
        ContentType: "application/json",
        ServerSideEncryption: "AES256",
      }),
    );
    return {
      key: artifact.key,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    };
  }
  async get(key: string, expectedHash: string) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
    );
    if (!response.Body) throw new Error("Trace artifact is missing");
    return decode(await response.Body.transformToString(), expectedHash);
  }
  async remove(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
    );
  }
}
