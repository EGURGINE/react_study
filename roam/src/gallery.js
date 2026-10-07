import { useCallback, useEffect, useRef, useState } from "react";

const PAGE_SIZE = 24;
const UNAVAILABLE = "사진 보관함 서버가 아직 연결되지 않았어요.";
const LOAD_ERROR = "사진을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";

export function resolveGalleryBase(
  serverUrl,
  development = false,
  origin = "",
) {
  const configured = typeof serverUrl === "string" ? serverUrl.trim() : "";
  const source = configured || (development ? origin : "");
  if (!source) return "";
  try {
    const url = new URL(source);
    if (url.protocol === "wss:") url.protocol = "https:";
    else if (url.protocol === "ws:") url.protocol = "http:";
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function normalizeGalleryPage(data, base) {
  if (!data || !Array.isArray(data.items))
    throw new Error("Invalid gallery page");
  if (
    data.nextCursor != null &&
    (typeof data.nextCursor !== "string" || data.nextCursor.length > 1024)
  )
    throw new Error("Invalid gallery cursor");

  const items = [];
  const seen = new Set();
  for (const item of data.items.slice(0, 48)) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) ||
      seen.has(item.id) ||
      item.path !== `/gallery/photos/${item.id}` ||
      typeof item.nickname !== "string" ||
      !item.nickname.trim() ||
      item.nickname.length > 128 ||
      typeof item.createdAt !== "string" ||
      !Number.isFinite(Date.parse(item.createdAt))
    )
      continue;
    seen.add(item.id);
    // Only the server's exact photo route is materialized; supplied src values,
    // absolute URLs, traversal paths, and query strings are never used.
    items.push({
      id: item.id,
      nickname: item.nickname,
      createdAt: item.createdAt,
      path: item.path,
      src: new URL(item.path, base).href,
    });
  }
  return { items, nextCursor: data.nextCursor || null };
}

export function mergeGalleryPage(
  previous,
  previousCursor,
  page,
  cursor = null,
) {
  if (cursor) {
    const merged = new Map(previous.map((item) => [item.id, item]));
    for (const item of page.items) merged.set(item.id, item);
    return {
      items: [...merged.values()],
      nextCursor: page.nextCursor === cursor ? null : page.nextCursor,
    };
  }

  const knownIds = new Set(previous.map((item) => item.id));
  const overlaps = page.items.some((item) => knownIds.has(item.id));
  if (!overlaps) return page;

  // Immutable archive entries can stay loaded when new photos arrive. An
  // overlapping first page proves there is no gap between it and our history;
  // retain the old tail cursor so "load more" continues where browsing stopped.
  const merged = new Map(page.items.map((item) => [item.id, item]));
  for (const item of previous)
    if (!merged.has(item.id)) merged.set(item.id, item);
  return { items: [...merged.values()], nextCursor: previousCursor };
}

export function useGallery(active, version = 0) {
  const base = resolveGalleryBase(
    import.meta.env?.VITE_MULTIPLAYER_URL,
    import.meta.env?.DEV,
    globalThis.location?.origin,
  );
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const request = useRef(null);
  const cursorRef = useRef(null);
  const itemsRef = useRef([]);

  const requestPage = useCallback(
    async (cursor = null) => {
      if (!active || !base) return false;
      // Repeated load-more clicks share the existing request. A first-page
      // refresh supersedes it, so stale pages cannot overwrite newer photos.
      if (cursor && request.current) return false;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 15000);
      setLoading(true);
      setError("");
      try {
        const url = new URL("/gallery", base);
        url.searchParams.set("limit", String(PAGE_SIZE));
        if (cursor) url.searchParams.set("before", cursor);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
          credentials: "omit",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Gallery request failed");
        const page = normalizeGalleryPage(await response.json(), base);
        if (controller.signal.aborted || request.current !== controller)
          return false;
        const merged = mergeGalleryPage(
          itemsRef.current,
          cursorRef.current,
          page,
          cursor,
        );
        itemsRef.current = merged.items;
        cursorRef.current = merged.nextCursor;
        setItems(merged.items);
        setNextCursor(merged.nextCursor);
        return true;
      } catch {
        if (
          request.current !== controller ||
          (controller.signal.aborted && !timedOut)
        )
          return false;
        setError(
          timedOut
            ? "사진 보관함 응답이 늦어지고 있어요. 다시 시도해 주세요."
            : LOAD_ERROR,
        );
        return false;
      } finally {
        clearTimeout(timeout);
        if (request.current === controller) {
          request.current = null;
          setLoading(false);
        }
      }
    },
    [active, base],
  );

  const refresh = useCallback(() => requestPage(), [requestPage]);
  const loadMore = useCallback(() => {
    if (!cursorRef.current) return Promise.resolve(false);
    return requestPage(cursorRef.current);
  }, [requestPage]);

  useEffect(() => {
    if (!active || !base) {
      setLoading(false);
      return;
    }
    requestPage();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [active, base, version, requestPage]);

  return {
    items,
    loading,
    error: base ? error : UNAVAILABLE,
    nextCursor,
    loadMore,
    refresh,
    configured: Boolean(base),
  };
}
