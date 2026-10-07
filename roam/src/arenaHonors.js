import { useCallback, useEffect, useRef, useState } from "react";
import { resolveGalleryBase } from "./gallery.js";

const EMPTY_HONORS = { latest: null, leaders: [], recent: [], total: 0 };
const validName = (value) =>
  typeof value === "string" && value.trim() && value.length <= 128;
const validDate = (value) =>
  Number.isFinite(value) && value >= 0 && value <= 8.64e15;
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;

export function normalizeArenaHonors(data) {
  if (
    !data ||
    !Array.isArray(data.leaders) ||
    !Array.isArray(data.recent) ||
    !validCount(data.total)
  ) {
    throw new Error("Invalid arena honors");
  }
  function victory(item) {
    if (
      !item ||
      typeof item.arenaId !== "string" ||
      !item.arenaId ||
      item.arenaId.length > 128 ||
      !validName(item.nickname) ||
      !validDate(item.wonAt) ||
      !validCount(item.players) ||
      !validCount(item.pot)
    )
      return null;
    return {
      arenaId: item.arenaId,
      nickname: item.nickname,
      wonAt: item.wonAt,
      players: item.players,
      pot: item.pot,
    };
  }
  const leaders = data.leaders.slice(0, 50).flatMap((item) => {
    if (
      !item ||
      !validName(item.nickname) ||
      !validCount(item.wins) ||
      item.wins < 1 ||
      !validDate(item.lastWonAt)
    )
      return [];
    return [
      { nickname: item.nickname, wins: item.wins, lastWonAt: item.lastWonAt },
    ];
  });
  const seen = new Set();
  const recent = data.recent.slice(0, 20).flatMap((item) => {
    const winner = victory(item);
    if (!winner || seen.has(winner.arenaId)) return [];
    seen.add(winner.arenaId);
    return [winner];
  });
  return { latest: victory(data.latest), leaders, recent, total: data.total };
}

export function useArenaHonors({ ready, open, live }) {
  const base = resolveGalleryBase(
    import.meta.env?.VITE_MULTIPLAYER_URL,
    import.meta.env?.DEV,
    globalThis.location?.origin,
  );
  const [honors, setHonors] = useState(EMPTY_HONORS);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(null);

  const refresh = useCallback(async () => {
    if (!ready || !base) return false;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12000);
    setLoading(true);
    setError("");
    try {
      const response = await fetch(new URL("/api/arena/honors", base), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Honors request failed");
      const next = normalizeArenaHonors(await response.json());
      if (controller.signal.aborted || request.current !== controller)
        return false;
      setHonors(next);
      setLoaded(true);
      return true;
    } catch {
      if (
        request.current !== controller ||
        (controller.signal.aborted && !timedOut)
      )
        return false;
      setError(
        timedOut
          ? "우승 기록 응답이 늦어지고 있어요. 다시 시도해 주세요."
          : "우승 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
      return false;
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }, [ready, base]);

  useEffect(() => {
    refresh();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!live) return;
    try {
      const next = normalizeArenaHonors(live);
      // A newer socket snapshot wins over a request already in flight.
      request.current?.abort();
      request.current = null;
      setHonors(next);
      setLoaded(true);
      setLoading(false);
      setError("");
    } catch {
      // Preserve the last valid public record when a snapshot is incomplete.
    }
  }, [live]);

  return {
    honors,
    loaded,
    loading,
    error: base ? error : "우승 기록 서버가 아직 연결되지 않았어요.",
    configured: Boolean(base),
    refresh,
  };
}
