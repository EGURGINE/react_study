import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createGameServer } from "./index.js";

const ORIGIN = "http://localhost:5173";
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const WEBP_BYTES = Buffer.from("524946460400000057454250", "hex");
const photoSource = (mime, bytes) =>
  `data:image/${mime};base64,${bytes.toString("base64")}`;
const JPEG = photoSource("jpeg", JPEG_BYTES);
const PNG = photoSource("png", PNG_BYTES);
const WEBP = photoSource("webp", WEBP_BYTES);

async function fixture(t, options = {}) {
  const server = createGameServer({ allowedOrigins: [ORIGIN], ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  });

  async function connect() {
    const socket = new WebSocket(base.replace("http:", "ws:") + "/ws", {
      origin: ORIGIN,
    });
    const queued = [];
    const pending = [];
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      const index = pending.findIndex(({ predicate }) => predicate(message));
      if (index >= 0) {
        const [{ resolve, timer }] = pending.splice(index, 1);
        clearTimeout(timer);
        resolve(message);
      } else {
        queued.push(message);
        if (queued.length > 200) queued.shift();
      }
    });
    const client = {
      socket,
      send: (message) => socket.send(JSON.stringify(message)),
      wait(predicate, timeout = 2000) {
        const index = queued.findIndex(predicate);
        if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
          const entry = { predicate, resolve, timer: null };
          entry.timer = setTimeout(() => {
            const index = pending.indexOf(entry);
            if (index >= 0) pending.splice(index, 1);
            reject(new Error("Timed out waiting for WebSocket message"));
          }, timeout);
          pending.push(entry);
        });
      },
      async join(nickname) {
        this.send({ type: "join", nickname });
        return this.wait(
          (message) => message.type === "welcome" || message.type === "error",
        );
      },
      async close() {
        const closed = once(socket, "close");
        socket.close();
        await closed;
      },
    };
    clients.push(client);
    await once(socket, "open");
    return client;
  }
  return { server, base, connect };
}

async function approach(client, current, target) {
  const steps = Math.ceil(
    Math.hypot(target.x - current.x, target.z - current.z) / 4,
  );
  let position = current;
  for (let step = 1; step <= steps; step += 1) {
    // Stay below the normal server movement budget; tests never bypass it to
    // place a client near an interaction or the expanded island boundary.
    await new Promise((resolve) => setTimeout(resolve, 180));
    const x = current.x + ((target.x - current.x) * step) / steps;
    const z = current.z + ((target.z - current.z) * step) / steps;
    client.send({ type: "move", x, z, heading: 0 });
    const state = await client.wait(
      (message) =>
        message.type === "state" &&
        message.players.some(
          (player) =>
            player.id === current.id && player.x === x && player.z === z,
        ),
    );
    position = state.players.find((player) => player.id === current.id);
  }
  return position;
}

async function travel(client, destination, target) {
  client.send({ type: "teleport", destination });
  const reply = await client.wait((message) => message.type === "teleport");
  return approach(client, reply.player, target);
}

test("concurrent admission caps the room at ten and a departure frees a slot", async (t) => {
  const room = await fixture(t);
  const clients = await Promise.all(
    Array.from({ length: 11 }, () => room.connect()),
  );
  const replies = await Promise.all(
    clients.map((client, index) => client.join(`driver-${index}`)),
  );
  const admitted = replies.flatMap((reply, index) =>
    reply.type === "welcome" ? [index] : [],
  );
  const refused = replies.findIndex((reply) => reply.code === "room_full");
  assert.equal(admitted.length, 10);
  assert.notEqual(refused, -1);
  assert.equal(
    new Set(admitted.map((index) => replies[index].player.id)).size,
    10,
  );
  assert.equal(
    new Set(admitted.map((index) => replies[index].player.color)).size,
    10,
  );
  assert.deepEqual(
    await fetch(`${room.base}/health`).then((response) => response.json()),
    { ok: true, players: 10, maxPlayers: 10 },
  );

  const departing = admitted[0];
  const departingId = replies[departing].player.id;
  const observer = clients[admitted[1]];
  await clients[departing].close();
  await observer.wait(
    (message) =>
      message.type === "state" &&
      message.players.length === 9 &&
      !message.players.some((player) => player.id === departingId),
  );
  const retry = await clients[refused].join(`driver-${refused}`);
  assert.equal(retry.type, "welcome");
  assert.equal(retry.players.length, 10);
});

test("nickname validation is recoverable and prevents normalized duplicate names", async (t) => {
  const room = await fixture(t);
  const first = await room.connect();
  assert.equal((await first.join("a")).code, "invalid_nickname");
  assert.equal((await first.join("First Driver")).type, "welcome");
  const second = await room.connect();
  assert.equal(
    (await second.join("  FIRST   DRIVER  ")).code,
    "nickname_taken",
  );
  assert.equal((await second.join("Ｆｉｒｓｔ Driver")).code, "nickname_taken");
  assert.equal((await second.join("Second Driver")).type, "welcome");
});

test("chat remains text data, uses session identity, reaches peers, and is rate limited", async (t) => {
  const room = await fixture(t);
  const author = await room.connect();
  const viewer = await room.connect();
  const welcome = await author.join("Real Driver");
  await viewer.join("Viewer");
  const text = '<img src=x onerror="alert(1)"> & <script>not HTML</script>';
  author.send({
    type: "chat",
    text,
    nickname: "Impersonated",
    color: "#000000",
    playerId: "forged",
  });
  const received = await viewer.wait((message) => message.type === "chat");
  assert.equal(received.message.text, text);
  assert.equal(received.message.nickname, "Real Driver");
  assert.equal(received.message.playerId, welcome.player.id);
  assert.equal(received.message.color, welcome.player.color);
  assert.ok(Number.isFinite(Date.parse(received.message.createdAt)));
  assert.equal(
    (await author.wait((message) => message.type === "chat")).message.id,
    received.message.id,
  );

  author.send({ type: "chat", text: "Too soon" });
  assert.equal(
    (await author.wait((message) => message.type === "error")).code,
    "rate_limited",
  );
  const newcomer = await room.connect();
  const recent = await newcomer.join("Newcomer");
  assert.equal(recent.messages.length, 1);
  assert.equal(recent.messages[0].text, text);
});

test("positions must be finite, inside the island, and within movement bounds", async (t) => {
  const room = await fixture(t);
  const client = await room.connect();
  const welcome = await client.join("Careful Driver");
  for (const move of [
    { x: "1", z: 0, heading: 0 },
    { x: null, z: 0, heading: 0 },
    { x: 0, z: 0, heading: null },
    { x: 21.31, z: 0, heading: 0 },
    { x: -12, z: 0, heading: 0 },
  ]) {
    client.send({ type: "move", ...move });
    assert.equal(
      (await client.wait((message) => message.type === "error")).code,
      "invalid_move",
    );
  }
  client.socket.send('{"type":"move","x":1e309,"z":0,"heading":0}');
  assert.equal(
    (await client.wait((message) => message.type === "error")).code,
    "invalid_move",
  );
  const x = welcome.player.x + 0.25;
  const z = welcome.player.z + 0.25;
  client.send({ type: "move", x, z, heading: Math.PI * 4 + 0.5 });
  const state = await client.wait(
    (message) =>
      message.type === "state" &&
      message.players.some(
        (player) => player.id === welcome.player.id && player.x === x,
      ),
  );
  const player = state.players.find(
    (player) => player.id === welcome.player.id,
  );
  assert.equal(player.z, z);
  assert.ok(Math.abs(player.heading - 0.5) < 1e-10);
});

test("unjoined and malformed messages do not create players; honks use session identity", async (t) => {
  const room = await fixture(t);
  const client = await room.connect();
  client.send({ type: "chat", text: "Before joining" });
  assert.equal(
    (await client.wait((message) => message.type === "error")).code,
    "not_joined",
  );
  client.socket.send("not json");
  assert.equal(
    (await client.wait((message) => message.type === "error")).code,
    "invalid_message",
  );
  const welcome = await client.join("Honk Driver");
  client.send({ type: "honk", id: "forged" });
  assert.equal(
    (await client.wait((message) => message.type === "honk")).id,
    welcome.player.id,
  );
  client.send({ type: "honk" });
  assert.equal(
    (await client.wait((message) => message.type === "error")).code,
    "rate_limited",
  );
});

test("untrusted origins cannot upgrade to WebSocket", async (t) => {
  const room = await fixture(t);
  const socket = new WebSocket(room.base.replace("http:", "ws:"), {
    origin: "https://untrusted.example",
  });
  socket.on("error", () => {});
  t.after(() => socket.terminate());
  const status = await new Promise((resolve, reject) => {
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      socket.terminate();
      resolve(response.statusCode);
    });
    socket.once("open", () =>
      reject(new Error("Untrusted origin was admitted")),
    );
  });
  assert.equal(status, 403);
  assert.equal(
    (await fetch(`${room.base}/health`).then((response) => response.json()))
      .players,
    0,
  );
});

test("idle connections are capped at fifty before joining", async (t) => {
  const room = await fixture(t);
  await Promise.all(Array.from({ length: 50 }, () => room.connect()));
  const socket = new WebSocket(room.base.replace("http:", "ws:"), {
    origin: ORIGIN,
  });
  socket.on("error", () => {});
  t.after(() => socket.terminate());
  const status = await new Promise((resolve, reject) => {
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      socket.terminate();
      resolve(response.statusCode);
    });
    socket.once("open", () =>
      reject(new Error("A fifty-first connection was admitted")),
    );
  });
  assert.equal(status, 503);
});

test("message floods and oversized payloads close their connections", async (t) => {
  const room = await fixture(t);
  const flood = await room.connect();
  const floodClosed = once(flood.socket, "close");
  for (let index = 0; index < 91; index += 1) flood.send({ type: "unknown" });
  assert.equal(
    (
      await flood.wait(
        (message) =>
          message.type === "error" && message.code === "rate_limited",
      )
    ).code,
    "rate_limited",
  );
  assert.equal((await floodClosed)[0], 1008);

  const oversized = await room.connect();
  const oversizedClosed = once(oversized.socket, "close");
  oversized.send({ type: "photo", src: "x".repeat(740 * 1024) });
  assert.equal((await oversizedClosed)[0], 1009);
});

test("named teleports use server destinations, broadcast presence, and have a cooldown", async (t) => {
  const room = await fixture(t);
  const destinations = {
    start: { x: 1.3, z: 7.8, heading: -Math.PI / 2.4 },
    work: { x: 1, z: -3.7, heading: Math.PI },
    about: { x: -8, z: 2.3, heading: Math.PI },
    play: { x: 8, z: 7.3, heading: Math.PI },
  };
  const observer = await room.connect();
  await observer.join("Map Observer");
  for (const [destination, expected] of Object.entries(destinations)) {
    const client = await room.connect();
    const welcome = await client.join(`Map ${destination}`);
    client.send({
      type: "teleport",
      destination,
      x: 999,
      z: 999,
      heading: 999,
    });
    const reply = await client.wait((message) => message.type === "teleport");
    assert.equal(reply.player.id, welcome.player.id);
    assert.deepEqual(
      { x: reply.player.x, z: reply.player.z, heading: reply.player.heading },
      expected,
    );
    await observer.wait(
      (message) =>
        message.type === "state" &&
        message.players.some(
          (player) =>
            player.id === welcome.player.id &&
            player.x === expected.x &&
            player.z === expected.z,
        ),
    );
    client.send({ type: "teleport", destination });
    assert.equal(
      (await client.wait((message) => message.type === "error")).code,
      "rate_limited",
    );
  }
});

test("teleports reject arbitrary coordinates and unrecognized destination keys", async (t) => {
  const room = await fixture(t);
  const client = await room.connect();
  const welcome = await client.join("Map Driver");
  assert.deepEqual(
    {
      x: welcome.player.x,
      z: welcome.player.z,
      heading: welcome.player.heading,
    },
    { x: -1.7, z: 7.8, heading: -Math.PI / 2.4 },
  );
  for (const payload of [
    { x: 2, z: 2, heading: 0 },
    { destination: "anywhere" },
    { destination: "__proto__" },
    { destination: "constructor" },
    { destination: { x: 2, z: 2 } },
  ]) {
    client.send({ type: "teleport", ...payload });
    assert.equal(
      (await client.wait((message) => message.type === "error")).code,
      "invalid_teleport",
    );
  }
  client.send({ type: "teleport", destination: "work" });
  assert.equal(
    (await client.wait((message) => message.type === "teleport")).player.x,
    1,
  );
});

test("photos reach peers and welcome snapshots, then clear immediately and disappear on departure", async (t) => {
  const room = await fixture(t);
  const author = await room.connect();
  const viewer = await room.connect();
  const welcome = await author.join("Photo Driver");
  assert.deepEqual(welcome.photos, []);
  const viewerWelcome = await viewer.join("Photo Viewer");
  author.send({
    type: "photo",
    src: JPEG,
    playerId: "forged",
    nickname: "Forged name",
  });
  const shown = await viewer.wait(
    (message) => message.type === "photo" && message.photo.src === JPEG,
  );
  assert.equal(shown.photo.playerId, welcome.player.id);
  assert.equal(shown.photo.nickname, "Photo Driver");
  assert.ok(Number.isFinite(Date.parse(shown.photo.createdAt)));
  assert.deepEqual(
    (await author.wait((message) => message.type === "photo")).photo,
    shown.photo,
  );

  const newcomer = await room.connect();
  const snapshot = await newcomer.join("Photo Newcomer");
  assert.deepEqual(snapshot.photos, [shown.photo]);
  assert.ok(
    snapshot.players.every(
      (player) =>
        !Object.hasOwn(player, "src") && !Object.hasOwn(player, "photo"),
    ),
  );
  const state = await viewer.wait((message) => message.type === "state");
  assert.ok(!Object.hasOwn(state, "photos"));
  assert.ok(!JSON.stringify(state).includes("data:image"));

  author.send({ type: "photo", src: null });
  const cleared = await viewer.wait(
    (message) => message.type === "photo" && message.photo.src === null,
  );
  assert.equal(cleared.photo.playerId, welcome.player.id);
  assert.equal(
    (
      await author.wait(
        (message) => message.type === "photo" && message.photo.src === null,
      )
    ).photo.playerId,
    welcome.player.id,
  );
  author.send({ type: "photo", src: PNG });
  assert.equal(
    (await author.wait((message) => message.type === "error")).code,
    "rate_limited",
  );

  viewer.send({ type: "photo", src: WEBP });
  await newcomer.wait(
    (message) => message.type === "photo" && message.photo.src === WEBP,
  );
  await viewer.close();
  const departed = await newcomer.wait(
    (message) =>
      message.type === "photo" &&
      message.photo.playerId === viewerWelcome.player.id &&
      message.photo.src === null,
  );
  assert.equal(departed.photo.nickname, "Photo Viewer");
  const after = await room.connect();
  assert.deepEqual((await after.join("After Photos")).photos, []);
});

test("photo validation rejects unsupported types, MIME mismatches, malformed base64, and oversized bytes", async (t) => {
  const room = await fixture(t);
  const tooLarge = Buffer.alloc(512 * 1024 + 1);
  JPEG_BYTES.copy(tooLarge);
  const cases = [
    { src: "https://example.com/photo.jpg", code: "invalid_photo" },
    {
      src: photoSource("svg+xml", Buffer.from("<svg/>")),
      code: "invalid_photo",
    },
    { src: photoSource("gif", Buffer.from("GIF89a")), code: "invalid_photo" },
    { src: photoSource("jpeg", PNG_BYTES), code: "invalid_photo" },
    { src: photoSource("png", JPEG_BYTES), code: "invalid_photo" },
    { src: photoSource("webp", JPEG_BYTES), code: "invalid_photo" },
    {
      src: photoSource("webp", Buffer.from("d2c9c6c604000000d7c5c2d0", "hex")),
      code: "invalid_photo",
    },
    { src: "data:image/jpeg;base64,/9j/@@==", code: "invalid_photo" },
    { src: "data:image/jpeg;base64,/9j/4A", code: "invalid_photo" },
    { src: "data:image/jpeg;base64,/9j/4B==", code: "invalid_photo" },
    { src: photoSource("jpeg", tooLarge), code: "photo_too_large" },
    { src: { data: JPEG }, code: "invalid_photo" },
  ];
  for (const [index, { src, code }] of cases.entries()) {
    const client = await room.connect();
    assert.equal((await client.join(`Validation ${index}`)).type, "welcome");
    client.send({ type: "photo", src });
    assert.equal(
      (await client.wait((message) => message.type === "error")).code,
      code,
    );
    await client.close();
  }
  const newcomer = await room.connect();
  assert.deepEqual((await newcomer.join("No Invalid Photos")).photos, []);
});

test("a 512 KiB photo is accepted and survives the next welcome snapshot", async (t) => {
  const room = await fixture(t);
  const author = await room.connect();
  await author.join("Large Photo");
  const bytes = Buffer.alloc(512 * 1024);
  JPEG_BYTES.copy(bytes);
  const src = photoSource("jpeg", bytes);
  author.send({ type: "photo", src });
  assert.equal(
    (await author.wait((message) => message.type === "photo")).photo.src,
    src,
  );
  const viewer = await room.connect();
  const welcome = await viewer.join("Large Viewer");
  assert.equal(welcome.photos.length, 1);
  assert.equal(welcome.photos[0].src, src);
  viewer.send({ type: "chat", text: "Still connected after the photo." });
  assert.equal(
    (await viewer.wait((message) => message.type === "chat")).message.text,
    "Still connected after the photo.",
  );
});

test("a new photo replaces the previous one after the three-second cooldown", async (t) => {
  const room = await fixture(t);
  const author = await room.connect();
  const welcome = await author.join("Replacing Photos");
  author.send({ type: "photo", src: JPEG });
  await author.wait((message) => message.type === "photo");
  author.send({ type: "photo", src: PNG });
  assert.equal(
    (await author.wait((message) => message.type === "error")).code,
    "rate_limited",
  );
  await new Promise((resolve) => setTimeout(resolve, 3050));
  author.send({ type: "photo", src: PNG });
  const replaced = await author.wait((message) => message.type === "photo");
  assert.equal(replaced.photo.src, PNG);
  const viewer = await room.connect();
  assert.deepEqual((await viewer.join("Replacement Viewer")).photos, [
    { ...replaced.photo, playerId: welcome.player.id },
  ]);
});

test("larger photo transport does not admit oversized join or chat messages", async (t) => {
  const room = await fixture(t);
  const unjoined = await room.connect();
  const unjoinedClosed = once(unjoined.socket, "close");
  unjoined.send({ type: "join", nickname: "x".repeat(9000) });
  assert.equal(
    (await unjoined.wait((message) => message.type === "error")).code,
    "message_too_large",
  );
  assert.equal((await unjoinedClosed)[0], 1009);

  const author = await room.connect();
  await author.join("Chat Limits");
  author.send({ type: "chat", text: "x".repeat(281) });
  assert.equal(
    (await author.wait((message) => message.type === "error")).code,
    "invalid_chat",
  );
  const authorClosed = once(author.socket, "close");
  author.send({ type: "chat", text: "x".repeat(9000) });
  assert.equal(
    (await author.wait((message) => message.type === "error")).code,
    "message_too_large",
  );
  assert.equal((await authorClosed)[0], 1009);
});

test("jump height is public, bounded, and optional for older movement clients", async (t) => {
  const room = await fixture(t);
  const client = await room.connect();
  const welcome = await client.join("Jump Heights");
  assert.equal(welcome.player.y, 0);
  const { x, z } = welcome.player;
  for (const y of [null, "1", -0.01, 8.01]) {
    client.send({ type: "move", x, y, z, heading: 0 });
    assert.equal(
      (await client.wait((message) => message.type === "error")).code,
      "invalid_move",
    );
  }
  client.socket.send(
    JSON.stringify({ type: "move", x, z, heading: 0 }).replace(
      '"heading":0',
      '"heading":0,"y":1e309',
    ),
  );
  assert.equal(
    (await client.wait((message) => message.type === "error")).code,
    "invalid_move",
  );
  client.send({ type: "move", x, y: 8, z, heading: 0 });
  await client.wait(
    (message) =>
      message.type === "state" &&
      message.players.some(
        (player) => player.id === welcome.player.id && player.y === 8,
      ),
  );
  client.send({ type: "move", x: x + 0.05, z, heading: 0 });
  const lowered = await client.wait(
    (message) =>
      message.type === "state" &&
      message.players.some(
        (player) => player.id === welcome.player.id && player.x === x + 0.05,
      ),
  );
  assert.equal(
    lowered.players.find((player) => player.id === welcome.player.id).y,
    0,
  );
  client.send({ type: "move", x: x + 0.05, y: 4, z, heading: 0 });
  await client.wait(
    (message) =>
      message.type === "state" &&
      message.players.some(
        (player) => player.id === welcome.player.id && player.y === 4,
      ),
  );
  client.send({ type: "teleport", destination: "start" });
  assert.equal(
    (await client.wait((message) => message.type === "teleport")).player.y,
    0,
  );
});

test("the expanded island permits its 21.3-unit boundary but rejects positions beyond it", async (t) => {
  const room = await fixture(t);
  const client = await room.connect();
  await client.join("Outer Explorer");
  const edge = await travel(client, "play", { x: 21.3, z: 0 });
  assert.equal(edge.x, 21.3);
  client.send({ type: "move", x: 21.31, z: 0, heading: 0 });
  assert.equal(
    (await client.wait((message) => message.type === "error")).code,
    "invalid_move",
  );
});

test("interactions reject unknown IDs, extra properties, and distant triggers", async (t) => {
  const room = await fixture(t);
  const client = await room.connect();
  await client.join("Honest Explorer");
  for (const payload of [
    { objectId: "unknown" },
    { objectId: "__proto__" },
    { objectId: "constructor" },
    { objectId: { kind: "pop" } },
    { objectId: "pop-1", kind: "jump" },
    { objectId: "pop-1", x: -15, z: 4 },
    { objectId: "pop-1", playerId: "forged" },
  ]) {
    client.send({ type: "interaction", ...payload });
    assert.equal(
      (await client.wait((message) => message.type === "error")).code,
      "invalid_interaction",
    );
  }
  client.send({ type: "interaction", objectId: "pop-1" });
  assert.equal(
    (await client.wait((message) => message.type === "error")).code,
    "interaction_out_of_range",
  );
});

test("all fixed interactions broadcast their server-defined kind and acting player", async (t) => {
  const room = await fixture(t);
  const viewer = await room.connect();
  await viewer.join("Interaction Viewer");
  const objects = [
    ["pop-1", "pop", "about", -15, 4],
    ["pop-2", "pop", "about", -16, 6],
    ["pop-3", "pop", "about", -14, 7],
    ["boost-1", "boost", "play", 16, 0],
    ["boost-2", "boost", "start", 0, 18],
    ["bumper-1", "bounce", "start", -8, 16],
    ["bumper-2", "bounce", "about", -11, 14],
    ["jump-1", "jump", "play", 14, 11],
    ["jump-2", "jump", "about", -16, -9],
  ];
  for (const [objectId, kind, destination, x, z] of objects) {
    const client = await room.connect();
    const welcome = await client.join(`Use ${objectId}`);
    await travel(client, destination, { x, z });
    client.send({ type: "interaction", objectId });
    const expected = {
      type: "interaction",
      objectId,
      kind,
      playerId: welcome.player.id,
    };
    assert.deepEqual(
      await viewer.wait(
        (message) =>
          message.type === "interaction" && message.objectId === objectId,
      ),
      expected,
    );
    assert.deepEqual(
      await client.wait((message) => message.type === "interaction"),
      expected,
    );
    await client.close();
  }
});

test("pop cooldown is shared across players per object, while boost cooldown is per player", async (t) => {
  const room = await fixture(t);
  const first = await room.connect();
  const second = await room.connect();
  const firstWelcome = await first.join("First Player");
  const secondWelcome = await second.join("Second Player");
  await Promise.all([
    travel(first, "about", { x: -15, z: 4 }),
    travel(second, "about", { x: -15, z: 4 }),
  ]);
  first.send({ type: "interaction", objectId: "pop-1" });
  await second.wait(
    (message) => message.type === "interaction" && message.objectId === "pop-1",
  );
  second.send({ type: "interaction", objectId: "pop-1" });
  assert.equal(
    (await second.wait((message) => message.type === "error")).code,
    "rate_limited",
  );
  second.send({ type: "interaction", objectId: "pop-2" });
  assert.equal(
    (
      await second.wait(
        (message) =>
          message.type === "interaction" && message.objectId === "pop-2",
      )
    ).playerId,
    secondWelcome.player.id,
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  second.send({ type: "interaction", objectId: "pop-1" });
  assert.equal(
    (await second.wait((message) => message.type === "error")).code,
    "rate_limited",
  );

  await Promise.all([
    travel(first, "play", { x: 16, z: 0 }),
    travel(second, "play", { x: 16, z: 0 }),
  ]);
  first.send({ type: "interaction", objectId: "boost-1" });
  assert.equal(
    (
      await first.wait(
        (message) =>
          message.type === "interaction" && message.objectId === "boost-1",
      )
    ).playerId,
    firstWelcome.player.id,
  );
  second.send({ type: "interaction", objectId: "boost-1" });
  assert.equal(
    (
      await second.wait(
        (message) =>
          message.type === "interaction" &&
          message.objectId === "boost-1" &&
          message.playerId === secondWelcome.player.id,
      )
    ).playerId,
    secondWelcome.player.id,
  );
  first.send({ type: "interaction", objectId: "boost-1" });
  assert.equal(
    (await first.wait((message) => message.type === "error")).code,
    "rate_limited",
  );
});

test("errors identify their operation without leaking a preceding request type", async (t) => {
  const room = await fixture(t);
  const client = await room.connect();
  client.send({ type: "chat", text: "Not joined yet" });
  const unjoined = await client.wait((message) => message.type === "error");
  assert.equal(unjoined.code, "not_joined");
  assert.equal(unjoined.operation, "chat");
  const badJoin = await client.join("x");
  assert.equal(badJoin.operation, "join");
  await client.join("Operation Checks");

  for (const [payload, expectedCode] of [
    [{ type: "photo", src: "not an image" }, "invalid_photo"],
    [{ type: "chat", text: "" }, "invalid_chat"],
    [{ type: "move", x: 100, z: 0, heading: 0 }, "invalid_move"],
    [{ type: "teleport", destination: "unknown" }, "invalid_teleport"],
    [{ type: "interaction", objectId: "unknown" }, "invalid_interaction"],
  ]) {
    client.send(payload);
    const rejected = await client.wait((message) => message.type === "error");
    assert.equal(rejected.operation, payload.type);
    assert.equal(rejected.code, expectedCode);
  }
  client.send({ type: "photo", src: JPEG });
  const photoLimited = await client.wait((message) => message.type === "error");
  assert.equal(photoLimited.code, "rate_limited");
  assert.equal(photoLimited.operation, "photo");
  client.send({ type: "chat", text: "A real message" });
  await client.wait((message) => message.type === "chat");
  client.send({ type: "chat", text: "Too soon" });
  const chatLimited = await client.wait((message) => message.type === "error");
  assert.equal(chatLimited.code, "rate_limited");
  assert.equal(chatLimited.operation, "chat");
  client.send({ type: "honk" });
  await client.wait((message) => message.type === "honk");
  client.send({ type: "honk" });
  assert.equal(
    (await client.wait((message) => message.type === "error")).operation,
    "honk",
  );

  for (const raw of [
    "not json",
    JSON.stringify({ type: "unknown" }),
    JSON.stringify({ type: null }),
    Buffer.from("binary"),
  ]) {
    client.socket.send(raw);
    const rejected = await client.wait((message) => message.type === "error");
    assert.equal(rejected.code, "invalid_message");
    assert.equal(rejected.operation, null);
    assert.ok(!Object.hasOwn(rejected, "player"));
  }
});

test("invalid movement returns only the last acknowledged public player pose", async (t) => {
  const room = await fixture(t);
  const client = await room.connect();
  const welcome = await client.join("Pose Recovery");
  const next = {
    x: welcome.player.x + 0.2,
    y: 2,
    z: welcome.player.z + 0.2,
    heading: 0.25,
  };
  client.send({ type: "move", ...next });
  const state = await client.wait(
    (message) =>
      message.type === "state" &&
      message.players.some(
        (player) => player.id === welcome.player.id && player.x === next.x,
      ),
  );
  const acknowledged = state.players.find(
    (player) => player.id === welcome.player.id,
  );
  for (const invalid of [
    { x: 20, y: 0, z: 0, heading: 0 },
    { x: next.x, y: 9, z: next.z, heading: 0 },
  ]) {
    client.send({ type: "move", ...invalid });
    const rejected = await client.wait((message) => message.type === "error");
    assert.equal(rejected.code, "invalid_move");
    assert.equal(rejected.operation, "move");
    assert.deepEqual(rejected.player, acknowledged);
    assert.deepEqual(Object.keys(rejected.player).sort(), [
      "color",
      "heading",
      "id",
      "nickname",
      "x",
      "y",
      "z",
    ]);
  }
});

test("verified boosts, jumps, and bumpers tolerate delayed frame batches at their real speeds", async (t) => {
  const room = await fixture(t);
  const effects = [
    { id: "boost-1", destination: "play", x: 16, z: 0, dx: -1, dz: 0, speed: 13, jump: 0, impossible: { x: -20, z: 0 } },
    { id: "jump-1", destination: "play", x: 14, z: 11, dx: -1, dz: 0, speed: 13, jump: 8.8, impossible: { x: -18, z: -8 } },
    { id: "bumper-1", destination: "start", x: -8, z: 16, dx: 0, dz: -1, speed: 10, jump: 3.5, impossible: { x: 18, z: -8 } },
  ];
  for (const effect of effects) {
    const client = await room.connect();
    const welcome = await client.join(`Delayed ${effect.id}`);
    await travel(client, effect.destination, effect);
    client.send({ type: "interaction", objectId: effect.id });
    await client.wait((message) => message.type === "interaction");

    // Model an 800 ms TCP delivery gap followed by the queued 80 ms frames.
    // The old fixed six-unit cap rejected all three legitimate trajectories.
    await new Promise((resolve) => setTimeout(resolve, 800));
    client.send({ type: "move", ...effect.impossible, y: 0, heading: 0 });
    const rejected = await client.wait((message) => message.type === "error");
    assert.equal(rejected.code, "invalid_move");
    assert.equal(rejected.operation, "move");
    assert.equal(rejected.player.x, effect.x);
    assert.equal(rejected.player.z, effect.z);
    assert.match(rejected.message, /[가-힣]/);

    const unexpected = [];
    const recordErrors = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "error") unexpected.push(message);
    };
    client.socket.on("message", recordErrors);
    let finalPosition;
    for (let frame = 1; frame <= 14; frame += 1) {
      if (frame > 10) await new Promise((resolve) => setTimeout(resolve, 80));
      const time = frame * 0.08;
      finalPosition = {
        x: effect.x + effect.dx * effect.speed * time,
        y: Math.max(0, effect.jump * time - 6 * time * time),
        z: effect.z + effect.dz * effect.speed * time,
        heading: Math.atan2(effect.dx, effect.dz),
      };
      client.send({ type: "move", ...finalPosition });
    }
    const state = await client.wait((message) => message.type === "state"
      && message.players.some((player) => player.id === welcome.player.id
        && player.x === finalPosition.x && player.z === finalPosition.z));
    const player = state.players.find((candidate) => candidate.id === welcome.player.id);
    assert.equal(player.y, finalPosition.y);
    assert.deepEqual(unexpected, []);
    client.socket.off("message", recordErrors);
    await client.close();
  }
});

test("regular stationary updates cannot bank a later impossible jump", async (t) => {
  const room = await fixture(t);
  const client = await room.connect();
  const welcome = await client.join("No Idle Credit");
  const pose = { x: welcome.player.x, y: 0, z: welcome.player.z, heading: 0 };
  for (let frame = 0; frame < 12; frame += 1) {
    client.send({ type: "move", ...pose });
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  client.send({ type: "move", ...pose, x: pose.x + 9 });
  const rejected = await client.wait((message) => message.type === "error");
  assert.equal(rejected.code, "invalid_move");
  assert.equal(rejected.player.x, pose.x);
});

test("earned catch-up credit expires and teleport does not preserve it", async (t) => {
  const room = await fixture(t);
  for (const resetWithTeleport of [false, true]) {
    const client = await room.connect();
    const welcome = await client.join(resetWithTeleport ? "Teleport Credit" : "Expiring Credit");
    await new Promise((resolve) => setTimeout(resolve, 800));
    let pose = { x: welcome.player.x + 8, y: 0, z: welcome.player.z, heading: 0 };
    client.send({ type: "move", ...pose });
    await client.wait((message) => message.type === "state"
      && message.players.some((player) => player.id === welcome.player.id && player.x === pose.x));
    if (resetWithTeleport) {
      client.send({ type: "teleport", destination: "start" });
      pose = (await client.wait((message) => message.type === "teleport")).player;
    } else {
      for (let frame = 0; frame < 4; frame += 1) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        client.send({ type: "move", ...pose });
      }
    }
    client.send({ type: "move", ...pose, x: pose.x + 9 });
    assert.equal((await client.wait((message) => message.type === "error")).code, "invalid_move");
    await client.close();
  }
});
