import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { createGameServer } from './index.js'

const ORIGIN = 'http://localhost:5173'

async function fixture(t, options = {}) {
  const server = createGameServer({ allowedOrigins: [ORIGIN], ...options })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`
  const clients = []
  t.after(async () => {
    for (const client of clients) client.socket.terminate()
    await new Promise((resolve) => server.close(resolve))
  })

  async function connect() {
    const socket = new WebSocket(base.replace('http:', 'ws:') + '/ws', { origin: ORIGIN })
    const queued = []
    const pending = []
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      const index = pending.findIndex(({ predicate }) => predicate(message))
      if (index >= 0) {
        const [{ resolve, timer }] = pending.splice(index, 1)
        clearTimeout(timer)
        resolve(message)
      } else {
        queued.push(message)
        if (queued.length > 200) queued.shift()
      }
    })
    const client = {
      socket,
      send: (message) => socket.send(JSON.stringify(message)),
      wait(predicate, timeout = 2000) {
        const index = queued.findIndex(predicate)
        if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0])
        return new Promise((resolve, reject) => {
          const entry = { predicate, resolve, timer: null }
          entry.timer = setTimeout(() => {
            const index = pending.indexOf(entry)
            if (index >= 0) pending.splice(index, 1)
            reject(new Error('Timed out waiting for WebSocket message'))
          }, timeout)
          pending.push(entry)
        })
      },
      async join(nickname) {
        this.send({ type: 'join', nickname })
        return this.wait((message) => message.type === 'welcome' || message.type === 'error')
      },
      async close() {
        const closed = once(socket, 'close')
        socket.close()
        await closed
      },
    }
    clients.push(client)
    await once(socket, 'open')
    return client
  }
  return { server, base, connect }
}

test('concurrent admission caps the room at ten and a departure frees a slot', async (t) => {
  const room = await fixture(t)
  const clients = await Promise.all(Array.from({ length: 11 }, () => room.connect()))
  const replies = await Promise.all(clients.map((client, index) => client.join(`driver-${index}`)))
  const admitted = replies.flatMap((reply, index) => reply.type === 'welcome' ? [index] : [])
  const refused = replies.findIndex((reply) => reply.code === 'room_full')
  assert.equal(admitted.length, 10)
  assert.notEqual(refused, -1)
  assert.equal(new Set(admitted.map((index) => replies[index].player.id)).size, 10)
  assert.equal(new Set(admitted.map((index) => replies[index].player.color)).size, 10)
  assert.deepEqual(await fetch(`${room.base}/health`).then((response) => response.json()), { ok: true, players: 10, maxPlayers: 10 })

  const departing = admitted[0]
  const departingId = replies[departing].player.id
  const observer = clients[admitted[1]]
  await clients[departing].close()
  await observer.wait((message) => message.type === 'state' && message.players.length === 9 && !message.players.some((player) => player.id === departingId))
  const retry = await clients[refused].join(`driver-${refused}`)
  assert.equal(retry.type, 'welcome')
  assert.equal(retry.players.length, 10)
})

test('nickname validation is recoverable and prevents normalized duplicate names', async (t) => {
  const room = await fixture(t)
  const first = await room.connect()
  assert.equal((await first.join('a')).code, 'invalid_nickname')
  assert.equal((await first.join('First Driver')).type, 'welcome')
  const second = await room.connect()
  assert.equal((await second.join('  FIRST   DRIVER  ')).code, 'nickname_taken')
  assert.equal((await second.join('Ｆｉｒｓｔ Driver')).code, 'nickname_taken')
  assert.equal((await second.join('Second Driver')).type, 'welcome')
})

test('chat remains text data, uses session identity, reaches peers, and is rate limited', async (t) => {
  const room = await fixture(t)
  const author = await room.connect()
  const viewer = await room.connect()
  const welcome = await author.join('Real Driver')
  await viewer.join('Viewer')
  const text = '<img src=x onerror="alert(1)"> & <script>not HTML</script>'
  author.send({ type: 'chat', text, nickname: 'Impersonated', color: '#000000', playerId: 'forged' })
  const received = await viewer.wait((message) => message.type === 'chat')
  assert.equal(received.message.text, text)
  assert.equal(received.message.nickname, 'Real Driver')
  assert.equal(received.message.playerId, welcome.player.id)
  assert.equal(received.message.color, welcome.player.color)
  assert.ok(Number.isFinite(Date.parse(received.message.createdAt)))
  assert.equal((await author.wait((message) => message.type === 'chat')).message.id, received.message.id)

  author.send({ type: 'chat', text: 'Too soon' })
  assert.equal((await author.wait((message) => message.type === 'error')).code, 'rate_limited')
  const newcomer = await room.connect()
  const recent = await newcomer.join('Newcomer')
  assert.equal(recent.messages.length, 1)
  assert.equal(recent.messages[0].text, text)
})

test('positions must be finite, inside the island, and within movement bounds', async (t) => {
  const room = await fixture(t)
  const client = await room.connect()
  const welcome = await client.join('Careful Driver')
  for (const move of [
    { x: '1', z: 0, heading: 0 },
    { x: null, z: 0, heading: 0 },
    { x: 0, z: 0, heading: null },
    { x: 14, z: 0, heading: 0 },
    { x: -12, z: 0, heading: 0 },
  ]) {
    client.send({ type: 'move', ...move })
    assert.equal((await client.wait((message) => message.type === 'error')).code, 'invalid_move')
  }
  client.socket.send('{"type":"move","x":1e309,"z":0,"heading":0}')
  assert.equal((await client.wait((message) => message.type === 'error')).code, 'invalid_move')
  const x = welcome.player.x + 0.25
  const z = welcome.player.z + 0.25
  client.send({ type: 'move', x, z, heading: Math.PI * 4 + 0.5 })
  const state = await client.wait((message) => message.type === 'state' && message.players.some((player) => player.id === welcome.player.id && player.x === x))
  const player = state.players.find((player) => player.id === welcome.player.id)
  assert.equal(player.z, z)
  assert.ok(Math.abs(player.heading - 0.5) < 1e-10)
})

test('unjoined and malformed messages do not create players; honks use session identity', async (t) => {
  const room = await fixture(t)
  const client = await room.connect()
  client.send({ type: 'chat', text: 'Before joining' })
  assert.equal((await client.wait((message) => message.type === 'error')).code, 'not_joined')
  client.socket.send('not json')
  assert.equal((await client.wait((message) => message.type === 'error')).code, 'invalid_message')
  const welcome = await client.join('Honk Driver')
  client.send({ type: 'honk', id: 'forged' })
  assert.equal((await client.wait((message) => message.type === 'honk')).id, welcome.player.id)
  client.send({ type: 'honk' })
  assert.equal((await client.wait((message) => message.type === 'error')).code, 'rate_limited')
})

test('untrusted origins cannot upgrade to WebSocket', async (t) => {
  const room = await fixture(t)
  const socket = new WebSocket(room.base.replace('http:', 'ws:'), { origin: 'https://untrusted.example' })
  socket.on('error', () => {})
  t.after(() => socket.terminate())
  const status = await new Promise((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      response.resume()
      socket.terminate()
      resolve(response.statusCode)
    })
    socket.once('open', () => reject(new Error('Untrusted origin was admitted')))
  })
  assert.equal(status, 403)
  assert.equal((await fetch(`${room.base}/health`).then((response) => response.json())).players, 0)
})

test('idle connections are capped at fifty before joining', async (t) => {
  const room = await fixture(t)
  await Promise.all(Array.from({ length: 50 }, () => room.connect()))
  const socket = new WebSocket(room.base.replace('http:', 'ws:'), { origin: ORIGIN })
  socket.on('error', () => {})
  t.after(() => socket.terminate())
  const status = await new Promise((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      response.resume()
      socket.terminate()
      resolve(response.statusCode)
    })
    socket.once('open', () => reject(new Error('A fifty-first connection was admitted')))
  })
  assert.equal(status, 503)
})

test('message floods and oversized payloads close their connections', async (t) => {
  const room = await fixture(t)
  const flood = await room.connect()
  const floodClosed = once(flood.socket, 'close')
  for (let index = 0; index < 91; index += 1) flood.send({ type: 'unknown' })
  assert.equal((await flood.wait((message) => message.type === 'error' && message.code === 'rate_limited')).code, 'rate_limited')
  assert.equal((await floodClosed)[0], 1008)

  const oversized = await room.connect()
  const oversizedClosed = once(oversized.socket, 'close')
  oversized.send({ type: 'join', nickname: 'x'.repeat(9000) })
  assert.equal((await oversizedClosed)[0], 1009)
})

test('named teleports use server destinations, broadcast presence, and have a cooldown', async (t) => {
  const room = await fixture(t)
  const destinations = {
    start: { x: 1.3, z: 7.8, heading: -Math.PI / 2.4 },
    work: { x: 1, z: -3.7, heading: Math.PI },
    about: { x: -8, z: 2.3, heading: Math.PI },
    play: { x: 8, z: 7.3, heading: Math.PI },
  }
  const observer = await room.connect()
  await observer.join('Map Observer')
  for (const [destination, expected] of Object.entries(destinations)) {
    const client = await room.connect()
    const welcome = await client.join(`Map ${destination}`)
    client.send({ type: 'teleport', destination, x: 999, z: 999, heading: 999 })
    const reply = await client.wait((message) => message.type === 'teleport')
    assert.equal(reply.player.id, welcome.player.id)
    assert.deepEqual({ x: reply.player.x, z: reply.player.z, heading: reply.player.heading }, expected)
    await observer.wait((message) => message.type === 'state' && message.players.some((player) => player.id === welcome.player.id && player.x === expected.x && player.z === expected.z))
    client.send({ type: 'teleport', destination })
    assert.equal((await client.wait((message) => message.type === 'error')).code, 'rate_limited')
  }
})

test('teleports reject arbitrary coordinates and unrecognized destination keys', async (t) => {
  const room = await fixture(t)
  const client = await room.connect()
  const welcome = await client.join('Map Driver')
  assert.deepEqual(
    { x: welcome.player.x, z: welcome.player.z, heading: welcome.player.heading },
    { x: -1.7, z: 7.8, heading: -Math.PI / 2.4 },
  )
  for (const payload of [
    { x: 2, z: 2, heading: 0 },
    { destination: 'anywhere' },
    { destination: '__proto__' },
    { destination: 'constructor' },
    { destination: { x: 2, z: 2 } },
  ]) {
    client.send({ type: 'teleport', ...payload })
    assert.equal((await client.wait((message) => message.type === 'error')).code, 'invalid_teleport')
  }
  client.send({ type: 'teleport', destination: 'work' })
  assert.equal((await client.wait((message) => message.type === 'teleport')).player.x, 1)
})
