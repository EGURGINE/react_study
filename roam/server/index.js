import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { createGalleryStore, GalleryError } from "./gallery.js";

const COLORS = [
  "#ef7861",
  "#79a995",
  "#e8ba68",
  "#7a9cc4",
  "#b19acb",
  "#d88ea5",
  "#75b9bd",
  "#d59d72",
  "#a5b66d",
  "#8d96c6",
];
const ISLAND_RADIUS = 21.3;
const JOIN_TIMEOUT_MS = 15_000;
const HEARTBEAT_MS = 15_000;
const MAX_CONNECTIONS = 50;
const MAX_MESSAGES_PER_SECOND = 90;
const MAX_MOVEMENT_SPEED = 24;
const MAX_MOVEMENT_BUDGET = 6;
// Ordinary 80 ms updates keep only the six-unit collision/jitter reserve.
// A missed group of updates may represent real travel, especially at boost
// speed. Preserve up to one second of server-earned credit briefly while the
// delayed group drains, without banking that credit during normal idle ticks.
const MOVEMENT_GAP_MS = 240;
const MOVEMENT_CATCHUP_MS = 250;
const MAX_CATCHUP_MOVEMENT_BUDGET = MAX_MOVEMENT_BUDGET + MAX_MOVEMENT_SPEED;
const MAX_STANDARD_MESSAGE_BYTES = 8192;
const MAX_PHOTO_BYTES = 512 * 1024;
const MAX_WEBSOCKET_PAYLOAD_BYTES = 740 * 1024;
const PHOTO_COOLDOWN_MS = 3000;
// A welcome can contain up to ten photos. Keep that legitimate snapshot below
// the slow-consumer limit; periodic movement updates are skipped while queued.
const MAX_BUFFERED_BYTES = 12 * 1024 * 1024;
const CLIENT_OPERATIONS = new Set([
  "join",
  "move",
  "chat",
  "photo",
  "teleport",
  "interaction",
  "honk",
]);
const DESTINATIONS = Object.freeze({
  start: Object.freeze({ x: 1.3, z: 7.8, heading: -Math.PI / 2.4 }),
  work: Object.freeze({ x: 1, z: -3.7, heading: Math.PI }),
  about: Object.freeze({ x: -8, z: 2.3, heading: Math.PI }),
  play: Object.freeze({ x: 8, z: 7.3, heading: Math.PI }),
});
const INTERACTIONS = Object.freeze({
  "pop-1": Object.freeze({ x: -15, z: 4, r: 0.9, kind: "pop" }),
  "pop-2": Object.freeze({ x: -16, z: 6, r: 0.9, kind: "pop" }),
  "pop-3": Object.freeze({ x: -14, z: 7, r: 0.9, kind: "pop" }),
  "boost-1": Object.freeze({ x: 16, z: 0, r: 1.2, kind: "boost" }),
  "boost-2": Object.freeze({ x: 0, z: 18, r: 1.2, kind: "boost" }),
  "bumper-1": Object.freeze({ x: -8, z: 16, r: 1, kind: "bounce" }),
  "bumper-2": Object.freeze({ x: -11, z: 14, r: 1, kind: "bounce" }),
  "jump-1": Object.freeze({ x: 14, z: 11, r: 1.3, kind: "jump" }),
  "jump-2": Object.freeze({ x: -16, z: -9, r: 1.3, kind: "jump" }),
});

function createOriginCheck(allowedOrigins) {
  const configured = allowedOrigins ?? process.env.ALLOWED_ORIGINS;
  if (configured != null) {
    const values =
      typeof configured === "string" ? configured.split(",") : [...configured];
    const origins = new Set(
      values.map((value) => value.trim()).filter(Boolean),
    );
    return (origin) => typeof origin === "string" && origins.has(origin);
  }
  return (origin) => {
    if (origin === "https://egurgine.github.io") return true;
    try {
      const url = new URL(origin);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        url.origin === origin
      );
    } catch {
      return false;
    }
  };
}

function normalizeNickname(value) {
  if (typeof value !== "string") return null;
  const nickname = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const length = [...nickname].length;
  return length >= 2 && length <= 18 && !/\p{C}/u.test(nickname)
    ? nickname
    : null;
}

export function validatePhotoSource(src) {
  if (typeof src !== "string") return "invalid_photo";
  const comma = src.indexOf(",");
  const mime = src.slice(0, comma);
  if (
    ![
      "data:image/jpeg;base64",
      "data:image/png;base64",
      "data:image/webp;base64",
    ].includes(mime)
  )
    return "invalid_photo";
  const encoded = src.slice(comma + 1);
  if (encoded.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4)
    return "photo_too_large";
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  )
    return "invalid_photo";
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_PHOTO_BYTES) return "photo_too_large";
  // Buffer's base64 decoder is permissive; round-tripping rejects malformed
  // padding and noncanonical unused bits as well as the character check above.
  if (bytes.toString("base64") !== encoded) return "invalid_photo";
  const jpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const png =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    bytes.subarray(8, 12).equals(Buffer.from("WEBP"));
  // This checks MIME and magic signatures, not full image structure. Browsers
  // decode these as image resources; no uploaded bytes are evaluated as HTML.
  if (
    !(mime === "data:image/jpeg;base64"
      ? jpeg
      : mime === "data:image/png;base64"
        ? png
        : webp)
  )
    return "invalid_photo";
  return { mime: mime.slice(5, -7), bytes };
}

/**
 * One ephemeral room. Deploy this process as a single instance: room state is
 * shared by its WebSocket clients, and intentionally resets when it restarts.
 * The gallery is stored separately on disk and survives room restarts.
 * ALLOWED_ORIGINS is an optional comma-separated override of the default list.
 */
export function createGameServer({
  allowedOrigins,
  maxPlayers = 10,
  galleryDirectory = process.env.GALLERY_DIR ||
    fileURLToPath(new URL("../data/gallery", import.meta.url)),
  galleryMaxBytes = Number(process.env.GALLERY_MAX_BYTES || 1024 * 1024 * 1024),
  galleryMaxItems = 50_000,
} = {}) {
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 10) {
    throw new RangeError("maxPlayers must be an integer between 1 and 10");
  }

  const originAllowed = createOriginCheck(allowedOrigins);
  const sessions = new Map();
  const players = new Map();
  const photos = new Map();
  const popCooldowns = new Map();
  const messages = [];
  const gallery = createGalleryStore(galleryDirectory, {
    maxBytes: galleryMaxBytes,
    maxItems: galleryMaxItems,
  });
  const pendingPhotos = new Set();
  let activeImages = 0;
  let closing = false;

  const server = createServer(async (request, response) => {
    response.setHeader("Vary", "Origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (originAllowed(request.headers.origin)) {
      response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
    }
    const json = (status, value) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(value));
    };
    try {
      // Match raw path segments; never decode uploaded IDs into filesystem paths.
      const [path] = (request.url || "").split("?");
      if (request.method !== "GET") return json(404, { error: "Not found" });
      if (path === "/health")
        return json(200, { ok: true, players: players.size, maxPlayers });
      if (path === "/gallery") {
        const params = new URL(request.url, "http://localhost").searchParams;
        if (
          params.getAll("limit").length > 1 ||
          params.getAll("before").length > 1
        ) {
          throw new GalleryError("Invalid gallery pagination", 400);
        }
        return json(
          200,
          await gallery.list({
            limit: params.get("limit") ?? "24",
            before: params.get("before"),
          }),
        );
      }
      if (path.startsWith("/gallery/photos/")) {
        if (activeImages >= 32)
          throw new GalleryError("Gallery image service is busy");
        activeImages += 1;
        let reading = true;
        let completed = false;
        let released = false;
        const release = () => {
          if (!reading && completed && !released) {
            released = true;
            activeImages -= 1;
          }
        };
        for (const event of ["finish", "close"])
          response.once(event, () => {
            completed = true;
            release();
          });
        response.setTimeout(15_000, () => response.destroy());
        try {
          const { bytes, mime } = await gallery.image(
            path.slice("/gallery/photos/".length),
          );
          if (!response.destroyed) {
            response.writeHead(200, {
              "Content-Type": mime,
              "Content-Length": bytes.length,
              "Cache-Control": "public, max-age=31536000, immutable",
            });
            response.end(bytes);
          }
        } finally {
          reading = false;
          release();
        }
        return;
      }
      json(404, { error: "Not found" });
    } catch (error) {
      if (response.destroyed) return;
      const status = error instanceof GalleryError ? error.status : 503;
      json(status, {
        error:
          status === 400
            ? "Invalid gallery pagination"
            : status === 404
              ? "Photo not found"
              : "Gallery temporarily unavailable",
      });
    }
  });

  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES,
    perMessageDeflate: false,
  });
  const publicPlayer = ({ id, nickname, color, x, y, z, heading }) => ({
    id,
    nickname,
    color,
    x,
    y,
    z,
    heading,
  });
  const publicPlayers = () =>
    [...players.values()].map(({ player }) => publicPlayer(player));

  function send(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  function error(socket, code, message, operation = null) {
    const player =
      code === "invalid_move" ? sessions.get(socket)?.player : null;
    send(socket, {
      type: "error",
      code,
      message,
      operation,
      ...(player ? { player: publicPlayer(player) } : {}),
    });
  }

  function broadcast(payload) {
    for (const { socket } of players.values()) send(socket, payload);
  }

  function broadcastState() {
    if (!players.size) return;
    const state = { type: "state", players: publicPlayers() };
    for (const { socket } of players.values()) {
      if (socket.bufferedAmount <= 128 * 1024) send(socket, state);
    }
  }

  function removeSession(socket) {
    const session = sessions.get(socket);
    if (!session) return;
    clearTimeout(session.joinTimeout);
    sessions.delete(socket);
    if (session.player) {
      players.delete(session.player.id);
      if (photos.delete(session.player.id) && !closing) {
        broadcast({
          type: "photo",
          photo: {
            playerId: session.player.id,
            nickname: session.player.nickname,
            src: null,
            createdAt: new Date().toISOString(),
          },
        });
      }
      if (!closing) broadcastState();
    }
  }

  function join(session, data) {
    if (session.player) {
      error(
        session.socket,
        "already_joined",
        "You have already joined the island.",
        "join",
      );
      return;
    }
    const nickname = normalizeNickname(data.nickname);
    if (!nickname) {
      error(
        session.socket,
        "invalid_nickname",
        "Choose a nickname with 2–18 characters.",
        "join",
      );
      return;
    }
    const nicknameKey = nickname.toLowerCase();
    if (
      [...players.values()].some((other) => other.nicknameKey === nicknameKey)
    ) {
      error(
        session.socket,
        "nickname_taken",
        "That nickname is already on the island.",
        "join",
      );
      return;
    }
    if (players.size >= maxPlayers) {
      error(
        session.socket,
        "room_full",
        "The island is full. Please try again when someone leaves.",
        "join",
      );
      return;
    }

    // Admission and insertion are synchronous, so simultaneous joins cannot
    // pass a stale capacity check in this single-process room.
    const usedColors = new Set(
      [...players.values()].map(({ player }) => player.color),
    );
    const color = COLORS.find((candidate) => !usedColors.has(candidate));
    const slot = COLORS.indexOf(color);
    session.player = {
      id: randomUUID(),
      nickname,
      color,
      x: DESTINATIONS.start.x + (slot % 5) * 1.5 - 3,
      y: 0,
      z: DESTINATIONS.start.z + Math.floor(slot / 5) * 1.7,
      heading: DESTINATIONS.start.heading,
    };
    session.nicknameKey = nicknameKey;
    session.movementAt = performance.now();
    session.movementBudget = MAX_MOVEMENT_BUDGET;
    session.movementCatchupUntil = 0;
    players.set(session.player.id, session);
    clearTimeout(session.joinTimeout);
    send(session.socket, {
      type: "welcome",
      player: { ...session.player },
      players: publicPlayers(),
      messages: [...messages],
      photos: [...photos.values()],
    });
    broadcastState();
  }

  function move(session, data, now) {
    const { x, y = 0, z, heading } = data;
    if (
      ![x, y, z, heading].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) ||
      Math.hypot(x, z) > ISLAND_RADIUS ||
      y < 0 ||
      y > 8
    ) {
      error(
        session.socket,
        "invalid_move",
        "아지트 안에서 움직여 주세요. 마지막으로 확인된 위치로 돌아갑니다.",
        "move",
      );
      return;
    }
    const elapsed = Math.max(0, (now - session.movementAt) / 1000);
    if (now - session.movementAt > MOVEMENT_GAP_MS) {
      session.movementCatchupUntil = now + MOVEMENT_CATCHUP_MS;
    }
    session.movementBudget = Math.min(
      now < session.movementCatchupUntil
        ? MAX_CATCHUP_MOVEMENT_BUDGET
        : MAX_MOVEMENT_BUDGET,
      session.movementBudget + elapsed * MAX_MOVEMENT_SPEED,
    );
    session.movementAt = now;
    const distance = Math.hypot(x - session.player.x, z - session.player.z);
    if (distance > session.movementBudget + 0.001) {
      error(
        session.socket,
        "invalid_move",
        "이동 위치를 다시 맞췄어요. 계속 운전해도 괜찮아요.",
        "move",
      );
      return;
    }
    session.movementBudget = Math.max(0, session.movementBudget - distance);
    Object.assign(session.player, {
      x,
      y,
      z,
      heading: Math.atan2(Math.sin(heading), Math.cos(heading)),
    });
  }

  function chat(session, data, now) {
    if (typeof data.text !== "string") {
      error(
        session.socket,
        "invalid_chat",
        "Enter a message with 1–280 characters.",
        "chat",
      );
      return;
    }
    const text = data.text.trim();
    if (
      !text ||
      [...text].length > 280 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)
    ) {
      error(
        session.socket,
        "invalid_chat",
        "Enter a message with 1–280 characters.",
        "chat",
      );
      return;
    }
    if (now - session.lastChatAt < 1000) {
      error(
        session.socket,
        "rate_limited",
        "Please wait a second before sending another message.",
        "chat",
      );
      return;
    }
    session.lastChatAt = now;
    const { id: playerId, nickname, color } = session.player;
    // Text remains plain data. Clients must render it as text, never as HTML.
    const message = {
      id: randomUUID(),
      playerId,
      nickname,
      color,
      text,
      createdAt: new Date().toISOString(),
    };
    messages.push(message);
    if (messages.length > 50) messages.shift();
    broadcast({ type: "chat", message });
  }

  function teleport(session, data, now) {
    if (
      typeof data.destination !== "string" ||
      !Object.hasOwn(DESTINATIONS, data.destination)
    ) {
      error(
        session.socket,
        "invalid_teleport",
        "Choose a destination on the island map.",
        "teleport",
      );
      return;
    }
    if (now - session.lastTeleportAt < 500) {
      error(
        session.socket,
        "rate_limited",
        "Please wait a moment before travelling again.",
        "teleport",
      );
      return;
    }
    session.lastTeleportAt = now;
    session.movementAt = now;
    session.movementBudget = MAX_MOVEMENT_BUDGET;
    session.movementCatchupUntil = 0;
    Object.assign(session.player, DESTINATIONS[data.destination], { y: 0 });
    send(session.socket, { type: "teleport", player: { ...session.player } });
    broadcastState();
  }

  function interaction(session, data, now) {
    if (
      typeof data.objectId !== "string" ||
      !Object.hasOwn(INTERACTIONS, data.objectId) ||
      Object.keys(data).some((key) => key !== "type" && key !== "objectId")
    ) {
      error(
        session.socket,
        "invalid_interaction",
        "Choose an interactive object on the island.",
        "interaction",
      );
      return;
    }
    const object = INTERACTIONS[data.objectId];
    if (
      Math.hypot(session.player.x - object.x, session.player.z - object.z) >
      object.r + 2
    ) {
      error(
        session.socket,
        "interaction_out_of_range",
        "Drive closer to that object first.",
        "interaction",
      );
      return;
    }
    if (object.kind === "pop") {
      if (now - (popCooldowns.get(data.objectId) ?? -Infinity) < 8000) {
        error(
          session.socket,
          "rate_limited",
          "That object is growing back. Try again in a few seconds.",
          "interaction",
        );
        return;
      }
      popCooldowns.set(data.objectId, now);
    } else {
      if (now - session.lastInteractionAt < 1000) {
        error(
          session.socket,
          "rate_limited",
          "Please wait a second before triggering another object.",
          "interaction",
        );
        return;
      }
      session.lastInteractionAt = now;
    }
    broadcast({
      type: "interaction",
      objectId: data.objectId,
      kind: object.kind,
      playerId: session.player.id,
    });
  }

  async function photo(session, data, now) {
    const { id: playerId, nickname } = session.player;
    if (data.src === null) {
      session.photoVersion += 1;
      const removed = {
        playerId,
        nickname,
        src: null,
        createdAt: new Date().toISOString(),
      };
      if (photos.delete(playerId)) broadcast({ type: "photo", photo: removed });
      else send(session.socket, { type: "photo", photo: removed });
      return;
    }
    if (session.photoPending || now - session.lastPhotoAt < PHOTO_COOLDOWN_MS) {
      error(
        session.socket,
        "rate_limited",
        "Please wait three seconds before sharing another photo.",
        "photo",
      );
      return;
    }
    // Limit upload attempts before base64 validation/decoding; clearing never
    // consumes or bypasses this budget, and is always available immediately.
    session.lastPhotoAt = now;
    const validated = validatePhotoSource(data.src);
    if (typeof validated === "string") {
      error(
        session.socket,
        validated,
        validated === "photo_too_large"
          ? "Keep shared photos at or below 512 KiB."
          : "Share a valid JPEG, PNG, or WebP image.",
        "photo",
      );
      return;
    }
    session.photoPending = true;
    const version = ++session.photoVersion;
    try {
      const item = await gallery.save({ nickname, ...validated });
      // A completed upload remains archived even if its author disconnected or
      // cleared the car during disk I/O. Neither case resurrects a car photo.
      if (!closing) broadcast({ type: "gallery:new", item });
      if (
        sessions.get(session.socket) === session &&
        session.photoVersion === version &&
        session.socket.readyState === WebSocket.OPEN &&
        !closing
      ) {
        const current = {
          playerId,
          nickname,
          src: data.src,
          createdAt: item.createdAt,
        };
        photos.set(playerId, current);
        broadcast({ type: "photo", photo: current });
      }
    } catch (failure) {
      error(
        session.socket,
        failure.code === "gallery_full"
          ? "gallery_full"
          : "gallery_unavailable",
        failure.code === "gallery_full"
          ? "사진 보관함이 가득 찼어요. 기존 사진은 그대로 보관되어 있어요."
          : "사진을 보관하지 못했어요. 잠시 후 다시 시도해 주세요.",
        "photo",
      );
    } finally {
      session.photoPending = false;
    }
  }

  sockets.on("connection", (socket) => {
    const session = {
      socket,
      player: null,
      alive: true,
      nicknameKey: null,
      windowAt: performance.now(),
      windowMessages: 0,
      movementAt: 0,
      movementBudget: 0,
      movementCatchupUntil: 0,
      lastChatAt: -Infinity,
      lastHonkAt: -Infinity,
      lastTeleportAt: -Infinity,
      lastPhotoAt: -Infinity,
      photoPending: false,
      photoVersion: 0,
      lastInteractionAt: -Infinity,
      joinTimeout: setTimeout(() => {
        error(
          socket,
          "join_timeout",
          "Please reconnect to choose your nickname.",
        );
        socket.close(1008, "Join timed out");
      }, JOIN_TIMEOUT_MS),
    };
    session.joinTimeout.unref();
    sessions.set(socket, session);
    // ws already initiates a protocol close (for example 1009 for payload size)
    // before emitting receiver errors. Let that frame flush instead of turning
    // a useful client error into an unexplained abnormal disconnect.
    socket.on("error", () => {
      if (socket.readyState === WebSocket.OPEN) socket.terminate();
    });
    socket.on("close", () => removeSession(socket));
    socket.on("pong", () => {
      session.alive = true;
    });

    socket.on("message", (raw, isBinary) => {
      if (closing) return;
      const now = performance.now();
      if (now - session.windowAt >= 1000) {
        session.windowAt = now;
        session.windowMessages = 0;
      }
      session.windowMessages += 1;
      if (session.windowMessages > MAX_MESSAGES_PER_SECOND) {
        if (session.windowMessages === MAX_MESSAGES_PER_SECOND + 1) {
          error(socket, "rate_limited", "Too many messages. Please reconnect.");
          socket.close(1008, "Message rate exceeded");
        }
        return;
      }
      if (isBinary) {
        error(socket, "invalid_message", "Send JSON text messages only.");
        return;
      }
      const large = raw.length > MAX_STANDARD_MESSAGE_BYTES;
      if (large && !session.player) {
        error(
          socket,
          "message_too_large",
          "Only joined players can send photo-sized messages.",
        );
        socket.close(1009, "Message too large");
        return;
      }
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        error(socket, "invalid_message", "The message was not valid JSON.");
        return;
      }
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        typeof data.type !== "string"
      ) {
        error(socket, "invalid_message", "The message needs a valid type.");
        return;
      }
      const operation = CLIENT_OPERATIONS.has(data.type) ? data.type : null;
      if (large && data.type !== "photo") {
        error(
          socket,
          "message_too_large",
          "Only photo messages can exceed 8 KiB.",
          operation,
        );
        socket.close(1009, "Message too large");
        return;
      }
      if (data.type === "join") {
        join(session, data);
        return;
      }
      if (!session.player) {
        error(
          socket,
          "not_joined",
          "Choose a nickname before entering the island.",
          operation,
        );
        return;
      }
      if (data.type === "move") move(session, data, now);
      else if (data.type === "chat") chat(session, data, now);
      else if (data.type === "teleport") teleport(session, data, now);
      else if (data.type === "photo") {
        const pending = photo(session, data, now);
        pendingPhotos.add(pending);
        pending.finally(() => pendingPhotos.delete(pending));
      } else if (data.type === "interaction") interaction(session, data, now);
      else if (data.type === "honk") {
        if (now - session.lastHonkAt < 1000) {
          error(
            socket,
            "rate_limited",
            "Please wait a second before honking again.",
            "honk",
          );
          return;
        }
        session.lastHonkAt = now;
        broadcast({ type: "honk", id: session.player.id });
      } else error(socket, "invalid_message", "Unknown message type.");
    });
  });

  server.on("upgrade", (request, socket, head) => {
    const reject = (status, reason) => {
      socket.end(
        `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    };
    if (!originAllowed(request.headers.origin)) {
      reject(403, "Forbidden");
      return;
    }
    if (closing || sockets.clients.size >= MAX_CONNECTIONS) {
      reject(503, "Service Unavailable");
      return;
    }
    if (
      request.method !== "GET" ||
      !["/", "/ws"].includes(request.url?.split("?")[0])
    ) {
      reject(404, "Not Found");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) =>
      sockets.emit("connection", client, request),
    );
  });

  const stateTimer = setInterval(broadcastState, 1000 / 15);
  stateTimer.unref();
  const heartbeatTimer = setInterval(() => {
    for (const [socket, session] of sessions) {
      if (!session.alive) {
        removeSession(socket);
        socket.terminate();
      } else if (socket.readyState === WebSocket.OPEN) {
        session.alive = false;
        socket.ping();
      }
    }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();

  function shutdown() {
    if (closing) return;
    closing = true;
    clearInterval(stateTimer);
    clearInterval(heartbeatTimer);
    for (const [socket, session] of sessions) {
      clearTimeout(session.joinTimeout);
      socket.terminate();
    }
    sessions.clear();
    players.clear();
    photos.clear();
    popCooldowns.clear();
    sockets.close();
  }

  const close = server.close;
  server.close = function closeGameServer(callback) {
    shutdown();
    return close.call(this, (error) => {
      Promise.allSettled([...pendingPhotos]).then(() => callback?.(error));
    });
  };
  server.on("close", shutdown);
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535");
  const server = createGameServer();
  server.listen(port, process.env.HOST || "0.0.0.0", () => {
    console.log(`ROAM multiplayer server listening on port ${port}`);
  });
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 5000).unref();
    });
  }
}
