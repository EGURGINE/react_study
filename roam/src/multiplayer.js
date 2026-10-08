import { useCallback, useEffect, useRef, useState } from "react";

export function useMultiplayer(position, notify, onInteraction, onGameEvent) {
  const configured = Boolean(
    import.meta.env.VITE_MULTIPLAYER_URL?.trim() || import.meta.env.DEV,
  );
  const [player, setPlayer] = useState(null),
    [peers, setPeers] = useState([]),
    [messages, setMessages] = useState([]),
    [connected, setConnected] = useState(false),
    [joining, setJoining] = useState(false),
    [error, setError] = useState(""),
    [honk, setHonk] = useState(null),
    [correction, setCorrection] = useState(null),
    [traveling, setTraveling] = useState(false),
    [photos, setPhotos] = useState({}),
    [uploading, setUploading] = useState(false),
    [galleryVersion, setGalleryVersion] = useState(0),
    [profile, setProfile] = useState(null),
    [races, setRaces] = useState([]),
    [raceResult, setRaceResult] = useState(null),
    [arenas, setArenas] = useState([]),
    [arenaResult, setArenaResult] = useState(null),
    [arenaHonors, setArenaHonors] = useState(null),
    [soccer, setSoccer] = useState(null),
    [fuel, setFuel] = useState(null),
    [soccerResult, setSoccerResult] = useState(null),
    [latestLap, setLatestLap] = useState(null),
    [lapProgress, setLapProgress] = useState({ active: false, progress: 0 }),
    [gameBusy, setGameBusy] = useState(false);
  const pendingGames = useRef(new Map());
  const attendanceRefresh = useRef({ pending: null, at: -Infinity });
  const clearGames = useCallback(() => {
    for (const request of pendingGames.current.values()) {
      clearTimeout(request.timer);
      request.resolve({ ok: false, message: "연결이 종료됐어요." });
    }
    pendingGames.current.clear();
    setGameBusy(false);
  }, []);
  const socket = useRef(null),
    identity = useRef(null),
    pending = useRef(null),
    mounted = useRef(true),
    joinTimer = useRef(null),
    pendingSend = useRef(null),
    sendTimer = useRef(null),
    travelPending = useRef(false),
    pendingPhoto = useRef(null),
    photoTimer = useRef(null);
  const join = useCallback(
    (nickname) =>
      new Promise((resolve) => {
        pending.current?.(false);
        clearTimeout(joinTimer.current);
        if (socket.current) socket.current.close();
        identity.current = null;
        setPlayer(null);
        setConnected(false);
        setPeers([]);
        setProfile(null);
        attendanceRefresh.current = { pending: null, at: -Infinity };
        setLapProgress({ active: false, progress: 0 });
        setRaces([]);
        setRaceResult(null);
        setArenas([]);
        setArenaResult(null);
        setSoccer(null);
        setFuel(null);
        setSoccerResult(null);
        clearGames();
        const base = import.meta.env.VITE_MULTIPLAYER_URL?.trim();
        const url =
          base ||
          (import.meta.env.DEV
            ? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/socket`
            : null);
        if (!url) {
          setError(
            "아직 멀티플레이 서버가 연결되지 않았어요. 먼저 혼자 둘러볼 수 있어요.",
          );
          resolve(false);
          return;
        }
        setJoining(true);
        setError("");
        pending.current = resolve;
        let ws;
        try {
          ws = new WebSocket(url);
        } catch {
          setJoining(false);
          setError("멀티플레이 서버 주소를 확인할 수 없어요.");
          resolve(false);
          return;
        }
        socket.current = ws;
        const finish = (ok) => {
          clearTimeout(joinTimer.current);
          setJoining(false);
          pending.current?.(ok);
          pending.current = null;
        };
        joinTimer.current = setTimeout(() => {
          setError("서버 연결이 지연되고 있어요. 잠시 후 다시 시도해 주세요.");
          finish(false);
          ws.close();
        }, 18000);
        ws.onopen = () => {
          let token;
          try {
            token = localStorage.getItem("roam-player-token-v1") || undefined;
          } catch {
            /* Storage may be disabled. */
          }
          ws.send(
            JSON.stringify({ type: "join", nickname: nickname.trim(), token }),
          );
        };
        ws.onmessage = (event) => {
          if (!mounted.current || socket.current !== ws) return;
          let data;
          try {
            data = JSON.parse(event.data);
          } catch {
            return;
          }
          if (data.type === "welcome") {
            identity.current = data.player;
            position.current = {
              ...position.current,
              x: data.player.x,
              y: data.player.y || 0,
              z: data.player.z,
              heading: data.player.heading,
              manualBoost: false,
            };
            setPlayer(data.player);
            setProfile(data.profile || null);
            setRaces(data.races || []);
            setArenas(data.arenas || []);
            setSoccer(data.soccer || null);
            setFuel(data.fuel || null);
            if (data.arenaHonors) setArenaHonors(data.arenaHonors);
            if (typeof data.resumeToken === "string") {
              try {
                localStorage.setItem("roam-player-token-v1", data.resumeToken);
              } catch {
                notify(
                  "브라우저 저장이 꺼져 있어요. 이 창을 닫으면 보유 차량과 코인을 다시 불러오지 못할 수 있어요.",
                );
              }
            }
            for (const spray of data.sprays || [])
              onGameEvent?.({ type: "spray", spray });
            setPeers(
              (data.players || []).filter((p) => p.id !== data.player.id),
            );
            setMessages(data.messages || []);
            setPhotos(
              Object.fromEntries(
                (data.photos || []).map((p) => [p.playerId, p]),
              ),
            );
            setConnected(true);
            setError("");
            finish(true);
            notify(`${data.player.nickname}님, 반가워요. 편하게 놀다 가세요!`);
          }
          if (data.type === "state")
            setPeers(data.players.filter((p) => p.id !== identity.current?.id));
          if (data.type === "chat") {
            setMessages((ms) => [...ms, data.message].slice(-100));
            if (data.message.playerId === identity.current?.id) {
              clearTimeout(sendTimer.current);
              pendingSend.current?.(true);
              pendingSend.current = null;
            }
          }
          if (data.type === "honk") setHonk({ id: data.id, at: Date.now() });
          if (data.type === "profile") setProfile(data.profile);
          if (data.type === "lap:progress")
            setLapProgress({
              active: Boolean(data.active),
              progress: Math.max(0, Math.min(1, Number(data.progress) || 0)),
            });
          if (data.type === "game:result") {
            const request = pendingGames.current.get(data.requestId);
            if (data.profile) setProfile(data.profile);
            if (request) {
              clearTimeout(request.timer);
              pendingGames.current.delete(data.requestId);
              setGameBusy(
                [...pendingGames.current.values()].some(
                  (pending) => !pending.quiet,
                ),
              );
              request.resolve(data);
              if (!request.quiet && !data.ok && data.message)
                notify(data.message);
            }
          }
          if (data.type === "race:state") setRaces(data.races || []);
          if (data.type === "arena:state") setArenas(data.arenas || []);
          if (data.type === "arena:honors") setArenaHonors(data.honors);
          if (data.type === "soccer:state") setSoccer(data.soccer || null);
          if (data.type === "fuel:state") setFuel(data.fuel || null);
          if (
            data.type === "fuel:event" &&
            data.playerId === identity.current?.id
          )
            notify(data.message);
          if (data.type === "soccer:finish" && data.result) {
            setSoccerResult({ ...data.result, receivedAt: Date.now() });
          }
          if (data.type === "arena:finish") {
            if (data.result?.winnerId) onGameEvent?.(data);
            if (
              identity.current &&
              data.result?.participantIds?.includes(identity.current.id)
            ) {
              setArenaResult({ ...data.result, receivedAt: Date.now() });
              if (data.profile) setProfile(data.profile);
            }
          }
          if (
            data.type === "race:finish" &&
            identity.current &&
            [data.result?.hostId, data.result?.guestId].includes(
              identity.current.id,
            )
          ) {
            setRaceResult({ ...data.result, receivedAt: Date.now() });
          }
          if (data.type === "lap" && data.playerId === identity.current?.id) {
            setLatestLap({ ...data, receivedAt: Date.now() });
            if (data.profile) setProfile(data.profile);
          }
          if (data.type === "spray") onGameEvent?.(data);
          if (data.type === "car:impact") onInteraction?.(data);
          if (data.type === "gallery:new")
            setGalleryVersion((version) => version + 1);
          if (
            data.type === "interaction" &&
            data.playerId !== identity.current?.id
          )
            onInteraction?.(data);
          if (data.type === "photo") {
            setPhotos((previous) => {
              const next = { ...previous };
              if (data.photo.src) next[data.photo.playerId] = data.photo;
              else delete next[data.photo.playerId];
              return next;
            });
            if (data.photo.playerId === identity.current?.id) {
              clearTimeout(photoTimer.current);
              pendingPhoto.current?.(true);
              pendingPhoto.current = null;
              setUploading(false);
            }
          }
          if (data.type === "teleport") {
            position.current = {
              ...position.current,
              x: data.player.x,
              y: data.player.y || 0,
              z: data.player.z,
              heading: data.player.heading,
              manualBoost: false,
            };
            travelPending.current = false;
            setTraveling(false);
            setCorrection({ ...data.player, at: Date.now() });
          }
          if (data.type === "error") {
            const operation = data.operation;
            if (!identity.current) {
              setError(data.message);
              finish(false);
            } else {
              if (operation === "photo") {
                clearTimeout(photoTimer.current);
                pendingPhoto.current?.(false);
                pendingPhoto.current = null;
                setUploading(false);
              }
              if (operation === "teleport") {
                travelPending.current = false;
                setTraveling(false);
              }
              if (operation === "chat") {
                clearTimeout(sendTimer.current);
                pendingSend.current?.(false);
                pendingSend.current = null;
              }
              if (operation === "move" && data.player) {
                position.current = {
                  ...position.current,
                  ...data.player,
                  y: data.player.y || 0,
                  manualBoost: false,
                };
                setCorrection({ ...data.player, at: Date.now() });
              }
              notify(data.message);
            }
          }
        };
        ws.onerror = () => {
          if (socket.current === ws) {
            setError(
              "지금은 멀티플레이 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.",
            );
            finish(false);
          }
        };
        ws.onclose = () => {
          if (socket.current !== ws || !mounted.current) return;
          finish(false);
          clearTimeout(sendTimer.current);
          pendingSend.current?.(false);
          pendingSend.current = null;
          clearTimeout(photoTimer.current);
          pendingPhoto.current?.(false);
          pendingPhoto.current = null;
          setUploading(false);
          clearGames();
          setProfile(null);
          setRaces([]);
          setArenas([]);
          setSoccer(null);
          setFuel(null);
          setPhotos({});
          setLapProgress({ active: false, progress: 0 });
          travelPending.current = false;
          setTraveling(false);
          const wasJoined = Boolean(identity.current);
          identity.current = null;
          setPlayer(null);
          setPeers([]);
          setConnected(false);
          if (wasJoined) notify("연결이 종료됐어요. 언제든 다시 들어오세요.");
        };
      }),
    [notify, onInteraction, onGameEvent, clearGames],
  );
  const send = useCallback(
    (text) =>
      new Promise((resolve) => {
        if (
          socket.current?.readyState !== WebSocket.OPEN ||
          !identity.current ||
          pendingSend.current
        ) {
          resolve(false);
          return;
        }
        pendingSend.current = resolve;
        sendTimer.current = setTimeout(() => {
          pendingSend.current?.(false);
          pendingSend.current = null;
          notify("메시지 전송을 확인하지 못했어요. 다시 시도해 주세요.");
        }, 5000);
        socket.current.send(JSON.stringify({ type: "chat", text }));
      }),
    [notify],
  );
  const honkNow = useCallback(() => {
    if (socket.current?.readyState === WebSocket.OPEN && identity.current)
      socket.current.send(JSON.stringify({ type: "honk" }));
  }, []);
  const emitInteraction = useCallback((event) => {
    if (socket.current?.readyState === WebSocket.OPEN && identity.current)
      socket.current.send(
        JSON.stringify({ type: "interaction", objectId: event.objectId }),
      );
  }, []);
  const leave = useCallback(() => {
    socket.current?.close();
    identity.current = null;
    setPlayer(null);
    setPeers([]);
    setConnected(false);
    setArenas([]);
    setSoccer(null);
    setFuel(null);
  }, []);
  const teleport = useCallback((destination) => {
    if (socket.current?.readyState === WebSocket.OPEN && identity.current) {
      if (travelPending.current) return true;
      travelPending.current = true;
      setTraveling(true);
      socket.current.send(JSON.stringify({ type: "teleport", destination }));
      return true;
    }
    return false;
  }, []);
  const cancelJoin = useCallback(() => {
    if (identity.current || !pending.current) return;
    const ws = socket.current;
    socket.current = null;
    clearTimeout(joinTimer.current);
    pending.current?.(false);
    pending.current = null;
    setJoining(false);
    ws?.close();
  }, []);
  const sharePhoto = useCallback(
    (src) =>
      new Promise((resolve) => {
        if (
          socket.current?.readyState !== WebSocket.OPEN ||
          !identity.current ||
          pendingPhoto.current
        ) {
          resolve(false);
          return;
        }
        setUploading(true);
        pendingPhoto.current = resolve;
        photoTimer.current = setTimeout(() => {
          pendingPhoto.current?.(false);
          pendingPhoto.current = null;
          setUploading(false);
          notify("사진을 공유하지 못했어요. 다시 시도해 주세요.");
        }, 15000);
        socket.current.send(JSON.stringify({ type: "photo", src }));
      }),
    [notify],
  );
  const gameAction = useCallback(
    (action, payload = {}, { quiet = false } = {}) =>
      new Promise((resolve) => {
        if (
          socket.current?.readyState !== WebSocket.OPEN ||
          !identity.current
        ) {
          if (!quiet) notify("닉네임으로 입장하면 함께 즐길 수 있어요.");
          resolve({ ok: false, message: "닉네임으로 먼저 입장해 주세요." });
          return;
        }
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          if (!pendingGames.current.has(requestId)) return;
          pendingGames.current.delete(requestId);
          setGameBusy(
            [...pendingGames.current.values()].some(
              (pending) => !pending.quiet,
            ),
          );
          const message =
            "서버 응답이 늦어지고 있어요. 보유 코인을 확인해 주세요.";
          if (!quiet) notify(message);
          resolve({ ok: false, message });
        }, 15000);
        pendingGames.current.set(requestId, { resolve, timer, quiet });
        if (!quiet) setGameBusy(true);
        socket.current.send(
          JSON.stringify({ ...payload, type: "game", action, requestId }),
        );
      }),
    [notify],
  );
  const refreshAttendance = useCallback(
    (force = false) => {
      if (!identity.current || socket.current?.readyState !== WebSocket.OPEN)
        return Promise.resolve({
          ok: false,
          message: "온라인 입장 후 확인할 수 있어요.",
        });
      const refresh = attendanceRefresh.current;
      if (refresh.pending) return refresh.pending;
      if (!force && performance.now() - refresh.at < 15000)
        return Promise.resolve({ ok: true });
      refresh.at = performance.now();
      refresh.pending = gameAction(
        "attendance:status",
        {},
        { quiet: true },
      ).finally(() => {
        refresh.pending = null;
      });
      return refresh.pending;
    },
    [gameAction],
  );
  useEffect(() => {
    if (!connected) return;
    const onVisible = () => {
      if (!document.hidden) void refreshAttendance();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [connected, refreshAttendance]);
  useEffect(() => {
    const attendance = profile?.attendance;
    if (
      !connected ||
      !Number.isFinite(attendance?.nextClaimAt) ||
      !Number.isFinite(attendance?.serverNow)
    )
      return;
    // Use a server-relative duration so changing the PC clock cannot mark a
    // reward available. The server still verifies the date on every claim.
    const wait = Math.min(
      86400000,
      Math.max(1000, attendance.nextClaimAt - attendance.serverNow + 150),
    );
    let cancelled = false;
    let retries = 0;
    let timer;
    const refreshAfterMidnight = async () => {
      if (cancelled) return;
      let succeeded = false;
      try {
        succeeded = Boolean((await refreshAttendance(true))?.ok);
      } catch {
        // A temporary transport failure should not strand yesterday's state.
      }
      if (cancelled || succeeded || retries >= 2) return;
      retries += 1;
      timer = setTimeout(refreshAfterMidnight, 15000);
    };
    timer = setTimeout(refreshAfterMidnight, wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    connected,
    profile?.attendance?.nextClaimAt,
    profile?.attendance?.serverNow,
    refreshAttendance,
  ]);
  const sprayNow = useCallback(() => gameAction("spray"), [gameAction]);
  useEffect(() => {
    mounted.current = true;
    const interval = setInterval(() => {
      const ws = socket.current;
      if (
        ws?.readyState === WebSocket.OPEN &&
        identity.current &&
        !document.hidden &&
        !travelPending.current &&
        !pendingPhoto.current &&
        ws.bufferedAmount < 16384
      ) {
        const p = position.current;
        ws.send(
          JSON.stringify({
            type: "move",
            x: p.x,
            y: p.y || 0,
            z: p.z,
            heading: p.heading,
            manualBoost: Boolean(p.manualBoost),
          }),
        );
      }
    }, 80);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      clearTimeout(joinTimer.current);
      clearTimeout(sendTimer.current);
      clearTimeout(photoTimer.current);
      socket.current?.close();
      pending.current?.(false);
      pendingSend.current?.(false);
      pendingPhoto.current?.(false);
      clearGames();
    };
  }, [position, clearGames]);
  const currentRace = player
    ? races.find(
        (race) => race.hostId === player?.id || race.guestId === player?.id,
      ) || null
    : null;
  const currentArena = player
    ? arenas.find((arena) =>
        arena.players?.some((participant) => participant.id === player.id),
      ) || null
    : null;
  const currentSoccer =
    player &&
    soccer?.players?.some((participant) => participant.id === player.id)
      ? soccer
      : null;
  return {
    configured,
    player,
    peers,
    messages,
    connected,
    joining,
    error,
    join,
    send,
    leave,
    honk,
    honkNow,
    teleport,
    correction,
    traveling,
    cancelJoin,
    photos,
    sharePhoto,
    uploading,
    galleryVersion,
    emitInteraction,
    profile,
    races,
    currentRace,
    raceResult,
    arenas,
    currentArena,
    arenaResult,
    arenaHonors,
    soccer,
    fuel,
    currentSoccer,
    soccerResult,
    latestLap,
    lapProgress,
    gameBusy,
    gameAction,
    refreshAttendance,
    sprayNow,
  };
}
