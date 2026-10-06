// Object storage for uploaded images and files (S3, Cloudflare R2, or MinIO locally).
// Bytes NEVER pass through this server: the API hands the browser a short-lived, pre-signed
// URL and the browser uploads straight to the bucket. The URL is signed for one exact key,
// content type and size, so it cannot be reused to store anything else.
import { GetObjectCommand, PutObjectCommand, S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface Storage {
  presignPut(key: string, contentType: string, size: number): Promise<string>
  presignGet(key: string, opts?: { download?: string }): Promise<string>
}

// What may be uploaded, and the file extension we store it under (never trust the filename)
export const ALLOWED_TYPES: Record<string, { ext: string; image: boolean }> = {
  'image/png': { ext: 'png', image: true },
  'image/jpeg': { ext: 'jpg', image: true },
  'image/gif': { ext: 'gif', image: true },
  'image/webp': { ext: 'webp', image: true },
  'application/pdf': { ext: 'pdf', image: false },
  'text/plain': { ext: 'txt', image: false },
}
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const PUT_SECONDS = 5 * 60
const GET_SECONDS = 10 * 60

export interface S3Settings { endpoint?: string; publicEndpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }

export function s3Settings(env = process.env): S3Settings | null {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null
  return {
    endpoint: env.S3_ENDPOINT || undefined, // R2: https://<account>.r2.cloudflarestorage.com, MinIO: http://127.0.0.1:9000
    // The address BROWSERS use, when it differs from the one this server uses (for example inside Docker,
    // where the server says http://minio:9000 and browsers say http://localhost:9000). Signed URLs carry it.
    publicEndpoint: env.S3_PUBLIC_ENDPOINT || undefined,
    region: env.S3_REGION || 'auto',
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  }
}

export function makeS3Client(s: S3Settings, endpoint = s.endpoint) {
  return new S3Client({
    region: s.region,
    endpoint,
    forcePathStyle: !!endpoint, // MinIO needs path-style; R2 accepts it
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
    // R2 and MinIO do not support the SDK's newer default checksum headers on pre-signed uploads
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

// Signing never touches the network, so this client can use the browsers' address
export function s3Storage(s: S3Settings, client = makeS3Client(s, s.publicEndpoint ?? s.endpoint)): Storage {
  return {
    presignPut: (key, contentType, size) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket: s.bucket, Key: key, ContentType: contentType, ContentLength: size }), {
        expiresIn: PUT_SECONDS,
        // sign these headers so the browser MUST send exactly this type and size
        signableHeaders: new Set(['content-type', 'content-length']),
      }),
    presignGet: (key, opts) =>
      getSignedUrl(client, new GetObjectCommand({
        Bucket: s.bucket, Key: key,
        ...(opts?.download ? { ResponseContentDisposition: `attachment; filename="${opts.download.replace(/[^\w.\- ]/g, '_')}"` } : {}),
      }), { expiresIn: GET_SECONDS }),
  }
}

// Local development convenience: create the bucket if it does not exist yet
export async function ensureBucket(s: S3Settings, client = makeS3Client(s)) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: s.bucket }))
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: s.bucket }))
  }
}
