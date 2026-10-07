import { randomUUID } from "node:crypto";
import { mkdir, open, opendir, rename, rm, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";

export const MAX_GALLERY_PHOTO_BYTES = 512 * 1024;
const ID_PATTERN =
  /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_METADATA_BYTES = 2048;
const MAX_SCAN_ENTRIES = 100_000;

export class GalleryError extends Error {
  constructor(message, status = 503, code = "gallery_unavailable") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function publicItem(metadata) {
  const { id, nickname, createdAt } = metadata;
  return { id, nickname, createdAt, path: `/gallery/photos/${id}` };
}

async function readBounded(path, maximum) {
  // Refuse links, and bound the read even if a local file changes after stat.
  if (!(await lstat(path)).isFile())
    throw new GalleryError("Invalid gallery file");
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) {
      throw new GalleryError("Gallery file exceeds its size limit");
    }
    const bytes = Buffer.alloc(Math.min(stat.size + 1, maximum + 1));
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length !== stat.size)
      throw new GalleryError("Gallery file changed during read");
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}

async function writeDurable(path, bytes) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function syncDirectory(path) {
  // Windows does not expose directory fsync through Node. Files are flushed
  // before the atomic directory rename on every platform.
  if (process.platform === "win32") return;
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/** Immutable photo directories are the index; listings never load image bytes. */
export function createGalleryStore(
  directory,
  { maxBytes = 1024 * 1024 * 1024, maxItems = 50_000 } = {},
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("Gallery maxBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 50_000) {
    throw new RangeError("Gallery maxItems must be between 1 and 50000");
  }
  const root = resolve(directory);
  const listings = new Map();
  let lastTimestamp = 0;
  let usedBytes = 0;
  let usedItems = 0;
  let usageReady = null;

  async function metadata(id) {
    if (!ID_PATTERN.test(id)) throw new GalleryError("Photo not found", 404);
    const folder = join(root, id);
    if (!(await lstat(folder)).isDirectory())
      throw new GalleryError("Invalid gallery folder");
    const record = JSON.parse(
      (
        await readBounded(join(folder, "metadata.json"), MAX_METADATA_BYTES)
      ).toString("utf8"),
    );
    if (
      record.id !== id ||
      typeof record.nickname !== "string" ||
      [...record.nickname].length < 2 ||
      [...record.nickname].length > 18 ||
      /\p{C}/u.test(record.nickname) ||
      !MIME_TYPES.has(record.mime) ||
      !Number.isInteger(record.size) ||
      record.size < 1 ||
      record.size > MAX_GALLERY_PHOTO_BYTES ||
      typeof record.createdAt !== "string" ||
      !Number.isFinite(Date.parse(record.createdAt))
    ) {
      throw new GalleryError("Invalid gallery metadata");
    }
    return record;
  }

  async function initializeUsage() {
    let entries;
    try {
      entries = await opendir(root);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    let scanned = 0;
    let total = 0;
    let count = 0;
    for await (const entry of entries) {
      if (++scanned > MAX_SCAN_ENTRIES)
        throw new GalleryError(
          "Gallery index needs maintenance: scan limit exceeded",
        );
      if (
        entry.name.startsWith(".pending-") &&
        ID_PATTERN.test(entry.name.slice(9))
      ) {
        // An interrupted, unacknowledged upload is never listed. Count its
        // remaining bytes and slot so repeated crashes cannot bypass quotas.
        if (!entry.isDirectory())
          throw new GalleryError("Invalid gallery staging folder");
        count += 1;
        try {
          const pendingImage = await lstat(join(root, entry.name, "image"));
          if (
            !pendingImage.isFile() ||
            pendingImage.size > MAX_GALLERY_PHOTO_BYTES
          )
            throw new GalleryError("Invalid gallery staging image");
          total += pendingImage.size;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        continue;
      }
      if (!ID_PATTERN.test(entry.name)) continue;
      if (!entry.isDirectory()) throw new GalleryError("Invalid gallery entry");
      const record = await metadata(entry.name);
      const imageStat = await lstat(join(root, entry.name, "image"));
      if (!imageStat.isFile() || imageStat.size !== record.size)
        throw new GalleryError("Incomplete gallery image");
      total += record.size;
      count += 1;
      lastTimestamp = Math.max(lastTimestamp, Number(entry.name.slice(0, 13)));
    }
    usedBytes = total;
    usedItems = count;
  }

  async function save({ nickname, mime, bytes }) {
    if (
      !MIME_TYPES.has(mime) ||
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      bytes.length > MAX_GALLERY_PHOTO_BYTES ||
      typeof nickname !== "string" ||
      [...nickname].length < 2 ||
      [...nickname].length > 18 ||
      /\p{C}/u.test(nickname)
    ) {
      throw new GalleryError("Invalid gallery photo", 400);
    }
    usageReady ??= initializeUsage().catch((error) => {
      usageReady = null;
      throw error;
    });
    await usageReady;
    // Reserve synchronously before I/O so concurrent clients cannot overfill
    // the archive. Existing images are never evicted to admit a new upload.
    if (usedBytes + bytes.length > maxBytes || usedItems >= maxItems) {
      throw new GalleryError("Gallery storage is full", 507, "gallery_full");
    }
    usedBytes += bytes.length;
    usedItems += 1;
    const timestamp = Math.max(Date.now(), lastTimestamp + 1);
    lastTimestamp = timestamp;
    const id = `${String(timestamp).padStart(13, "0")}-${randomUUID()}`;
    const record = {
      id,
      nickname,
      createdAt: new Date(timestamp).toISOString(),
      mime,
      size: bytes.length,
    };
    const temporary = join(root, `.pending-${id}`);
    let published = false;
    try {
      await mkdir(root, { recursive: true });
      await mkdir(temporary);
      await writeDurable(join(temporary, "image"), bytes);
      await writeDurable(
        join(temporary, "metadata.json"),
        JSON.stringify(record),
      );
      await syncDirectory(temporary);
      // Publishing one directory makes metadata and image visible together.
      await rename(temporary, join(root, id));
      published = true;
      await syncDirectory(root);
      return publicItem(record);
    } catch (error) {
      // Only clean this failed upload's staging folder, never published photos.
      let removed = false;
      try {
        await rm(temporary, { recursive: true, force: true });
        removed = true;
      } catch {
        /* Keep the reservation if cleanup fails. */
      }
      if (!published && removed) {
        usedBytes -= bytes.length;
        usedItems -= 1;
      }
      throw error;
    }
  }

  async function list({ limit = "24", before = null } = {}) {
    if (
      !/^[1-9]\d?$/.test(String(limit)) ||
      Number(limit) > 48 ||
      (before !== null &&
        (typeof before !== "string" || !ID_PATTERN.test(before)))
    ) {
      throw new GalleryError("Invalid gallery pagination", 400);
    }
    // Share identical requests and bound concurrent directory walks. Resource
    // limits produce an explicit error, never a silently truncated archive.
    const key = `${limit}:${before}`;
    if (listings.has(key)) return listings.get(key);
    if (listings.size >= 4) throw new GalleryError("Gallery listing is busy");
    const result = (async () => {
      try {
        let entries;
        try {
          entries = await opendir(root);
        } catch (error) {
          if (error.code === "ENOENT") return { items: [], nextCursor: null };
          throw error;
        }
        const selected = [];
        const count = Number(limit);
        let scanned = 0;
        for await (const entry of entries) {
          if (++scanned > MAX_SCAN_ENTRIES) {
            throw new GalleryError(
              "Gallery index needs maintenance: scan limit exceeded",
            );
          }
          if (!ID_PATTERN.test(entry.name)) continue;
          if (!entry.isDirectory())
            throw new GalleryError("Invalid gallery entry");
          if (before !== null && entry.name >= before) continue;
          const index = selected.findIndex((id) => id < entry.name);
          selected.splice(index < 0 ? selected.length : index, 0, entry.name);
          if (selected.length > count + 1) selected.pop();
        }
        const hasMore = selected.length > count;
        const page = selected.slice(0, count);
        const items = await Promise.all(
          page.map(async (id) => publicItem(await metadata(id))),
        );
        return { items, nextCursor: hasMore ? page.at(-1) : null };
      } finally {
        listings.delete(key);
      }
    })();
    listings.set(key, result);
    return result;
  }

  async function image(id) {
    try {
      const record = await metadata(id);
      const bytes = await readBounded(
        join(root, id, "image"),
        MAX_GALLERY_PHOTO_BYTES,
      );
      if (bytes.length !== record.size)
        throw new GalleryError("Incomplete gallery image");
      return { bytes, mime: record.mime };
    } catch (error) {
      if (error.code === "ENOENT")
        throw new GalleryError("Photo not found", 404);
      throw error;
    }
  }

  return { save, list, image };
}
