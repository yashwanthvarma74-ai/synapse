# ADR 0014: Uploads go straight to object storage with pre-signed URLs

**Status:** accepted

## Context

The brief calls for images and files, uploaded directly with pre-signed URLs (S3 or Cloudflare R2).
Passing file bytes through the API would tie up Node processes and need body-size handling.

## Decision

1. The editor asks `POST /documents/:id/uploads` with a name, a content type and a size. The server
   requires the **editor** role on the document and checks the type against an allowlist (PNG, JPEG,
   GIF, WebP, PDF, plain text) and a 10 MB limit.
2. It answers with a URL **signed for that exact key, content type and size**, valid for 5 minutes.
   The key is `<docId>/<32 random hex>.<extension>`: the client's file name is never used.
3. The browser PUTs the bytes to the bucket. The server never sees them.
4. The document stores `/files/<docId>/<name>`. That route redirects to a fresh 10-minute download URL.
   The bucket stays private.

Works with AWS S3, Cloudflare R2 and MinIO through one S3 client (`S3_*` settings). If they are not
set, uploads are off and the app says so.

## Evidence

`server/test/uploads.test.ts` (12 tests) covers roles (viewers and commenters refused), types, size,
path tricks, and that the real signer signs `content-type` and `content-length` and expires in
300 s / 600 s. Against a real MinIO: the honest upload returned 200, **a different content type and a
larger file were both refused with 403 by the bucket itself**, and the download came back
byte-identical. In real Chromium and WebKit (`e2e`), a pasted image uploaded, appeared, and was
downloaded back from the bucket at the right size.

## Consequences and risks

- **File links are capabilities.** `/files/...` needs no login, because an `<img>` tag cannot send an
  authorization header. Safety rests on the 128-bit random name, like the invite links in ADR 0012. Anyone
  who has the link can view the file; revoking access to a document does not hide images already
  shared as links. A signed-cookie or proxy design would fix this and is the next step for private data.
- **SVG and HTML are refused** because they can run script when opened.
- **No virus scanning, no image re-encoding, no cleanup of files whose document is deleted.**
- **No quota per user or workspace**, only a per-IP request limiter on the permit route.
- **The bucket needs a CORS rule** allowing `PUT` from the web origin (MinIO's default allows all; R2
  and S3 need it set; see `docs/DEPLOY.md`).
- Browsers upload directly, so the bucket address must be reachable from the browser (`S3_PUBLIC_ENDPOINT`
  when the server reaches it by another name, as in Docker).
- MinIO, used here for local development, is archived upstream and marked deprecated by Homebrew; it
  still works, but consider another S3-compatible server for the long term.

## Alternatives

Upload through the API (simpler, costs CPU and memory); store files in MongoDB GridFS (one fewer
service, worse for large or popular files).
