import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'

const COLORS = ['#ef7861', '#79a995', '#e8ba68', '#7a9cc4', '#b19acb', '#d88ea5', '#75b9bd', '#d59d72', '#a5b66d', '#8d96c6']
const ISLAND_RADIUS = 13.4
const JOIN_TIMEOUT_MS = 15_000
const HEARTBEAT_MS = 15_000
const MAX_CONNECTIONS = 50
const MAX_MESSAGES_PER_SECOND = 90
const MAX_MOVEMENT_SPEED = 24
const MAX_MOVEMENT_BUDGET = 6
const DESTINATIONS = Object.freeze({
  start: Object.freeze({ x: 1.3, z: 7.8, heading: -Math.PI / 2.4 }),
  work: Object.freeze({ x: 1, z: -3.7, heading: Math.PI }),
  about: Object.freeze({ x: -8, z: 2.3, heading: Math.PI }),
  play: Object.freeze({ x: 8, z: 7.3, heading: Math.PI }),
})

function createOriginCheck(allowedOrigins) {
  const configured = allowedOrigins ?? process.env.ALLOWED_ORIGINS
  if (configured != null) {
    const values = typeof configured === 'string' ? configured.split(',') : [...configured]
    const origins = new Set(values.map((value) => value.trim()).filter(Boolean))
    return (origin) => typeof origin === 'string' && origins.has(origin)
  }
  return (origin) => {
    if (origin === 'https://egurgine.github.io') return true
    try {
      const url = new URL(origin)
      return ['http:', 'https:'].includes(url.protocol)
        && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        && url.origin === origin
    } catch {
      return false
    }
  }
}

function normalizeNickname(value) {
  if (typeof value !== 'string') return null
  const nickname = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  const length = [...nickname].length
  return length >= 2 && length <= 18 && !/\p{C}/u.test(nickname) ? nickname : null
}

/**
 * One ephemeral room. Deploy this process as a single instance: room state is
 * shared by its WebSocket clients, and intentionally resets when it restarts.
 * ALLOWED_ORIGINS is an optional comma-separated override of the default list.
 */
export function createGameServer({ allowedOrigins, maxPlayers = 10 } = {}) {
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 10) {
    throw new RangeError('maxPlayers must be an integer between 1 and 10')
  }

  const originAllowed = createOriginCheck(allowedOrigins)
  const sessions = new Map()
  const players = new Map()
  const messages = []
  let closing = false

  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url?.split('?')[0] === '/health') {
      if (originAllowed(request.headers.origin)) {
        response.setHeader('Access-Control-Allow-Origin', request.headers.origin)
        response.setHeader('Vary', 'Origin')
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify({ ok: true, players: players.size, maxPlayers }))
      return
    }
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ error: 'Not found' }))
  })

  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false })
  const publicPlayers = () => [...players.values()].map(({ player }) => ({ ...player }))

  function send(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) return
    if (socket.bufferedAmount > 128 * 1024) {
      socket.terminate()
      return
    }
    socket.send(JSON.stringify(payload))
  }

  function error(socket, code, message) {
    send(socket, { type: 'error', code, message })
  }

  function broadcast(payload) {
    for (const { socket } of players.values()) send(socket, payload)
  }

  function broadcastState() {
    if (players.size) broadcast({ type: 'state', players: publicPlayers() })
  }

  function removeSession(socket) {
    const session = sessions.get(socket)
    if (!session) return
    clearTimeout(session.joinTimeout)
    sessions.delete(socket)
    if (session.player) {
      players.delete(session.player.id)
      if (!closing) broadcastState()
    }
  }

  function join(session, data) {
    if (session.player) {
      error(session.socket, 'already_joined', 'You have already joined the island.')
      return
    }
    const nickname = normalizeNickname(data.nickname)
    if (!nickname) {
      error(session.socket, 'invalid_nickname', 'Choose a nickname with 2–18 characters.')
      return
    }
    const nicknameKey = nickname.toLowerCase()
    if ([...players.values()].some((other) => other.nicknameKey === nicknameKey)) {
      error(session.socket, 'nickname_taken', 'That nickname is already on the island.')
      return
    }
    if (players.size >= maxPlayers) {
      error(session.socket, 'room_full', 'The island is full. Please try again when someone leaves.')
      return
    }

    // Admission and insertion are synchronous, so simultaneous joins cannot
    // pass a stale capacity check in this single-process room.
    const usedColors = new Set([...players.values()].map(({ player }) => player.color))
    const color = COLORS.find((candidate) => !usedColors.has(candidate))
    const slot = COLORS.indexOf(color)
    session.player = {
      id: randomUUID(), nickname, color,
      x: DESTINATIONS.start.x + (slot % 5) * 1.5 - 3,
      z: DESTINATIONS.start.z + Math.floor(slot / 5) * 1.7,
      heading: DESTINATIONS.start.heading,
    }
    session.nicknameKey = nicknameKey
    session.movementAt = performance.now()
    session.movementBudget = MAX_MOVEMENT_BUDGET
    players.set(session.player.id, session)
    clearTimeout(session.joinTimeout)
    send(session.socket, { type: 'welcome', player: { ...session.player }, players: publicPlayers(), messages: [...messages] })
    broadcastState()
  }

  function move(session, data, now) {
    const { x, z, heading } = data
    if (![x, z, heading].every((value) => typeof value === 'number' && Number.isFinite(value))
      || Math.hypot(x, z) > ISLAND_RADIUS) {
      error(session.socket, 'invalid_move', 'Position must stay within the island.')
      return
    }
    const elapsed = Math.max(0, (now - session.movementAt) / 1000)
    session.movementBudget = Math.min(MAX_MOVEMENT_BUDGET, session.movementBudget + elapsed * MAX_MOVEMENT_SPEED)
    session.movementAt = now
    const distance = Math.hypot(x - session.player.x, z - session.player.z)
    if (distance > session.movementBudget + 0.001) {
      error(session.socket, 'invalid_move', 'That movement was too fast. Please reconnect if your position is out of sync.')
      return
    }
    session.movementBudget = Math.max(0, session.movementBudget - distance)
    Object.assign(session.player, { x, z, heading: Math.atan2(Math.sin(heading), Math.cos(heading)) })
  }

  function chat(session, data, now) {
    if (typeof data.text !== 'string') {
      error(session.socket, 'invalid_chat', 'Enter a message with 1–280 characters.')
      return
    }
    const text = data.text.trim()
    if (!text || [...text].length > 280 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
      error(session.socket, 'invalid_chat', 'Enter a message with 1–280 characters.')
      return
    }
    if (now - session.lastChatAt < 1000) {
      error(session.socket, 'rate_limited', 'Please wait a second before sending another message.')
      return
    }
    session.lastChatAt = now
    const { id: playerId, nickname, color } = session.player
    // Text remains plain data. Clients must render it as text, never as HTML.
    const message = { id: randomUUID(), playerId, nickname, color, text, createdAt: new Date().toISOString() }
    messages.push(message)
    if (messages.length > 50) messages.shift()
    broadcast({ type: 'chat', message })
  }

  function teleport(session, data, now) {
    if (typeof data.destination !== 'string' || !Object.hasOwn(DESTINATIONS, data.destination)) {
      error(session.socket, 'invalid_teleport', 'Choose a destination on the island map.')
      return
    }
    if (now - session.lastTeleportAt < 500) {
      error(session.socket, 'rate_limited', 'Please wait a moment before travelling again.')
      return
    }
    session.lastTeleportAt = now
    session.movementAt = now
    session.movementBudget = MAX_MOVEMENT_BUDGET
    Object.assign(session.player, DESTINATIONS[data.destination])
    send(session.socket, { type: 'teleport', player: { ...session.player } })
    broadcastState()
  }

  sockets.on('connection', (socket) => {
    const session = {
      socket, player: null, alive: true, nicknameKey: null,
      windowAt: performance.now(), windowMessages: 0,
      movementAt: 0, movementBudget: 0, lastChatAt: -Infinity, lastHonkAt: -Infinity,
      lastTeleportAt: -Infinity,
      joinTimeout: setTimeout(() => {
        error(socket, 'join_timeout', 'Please reconnect to choose your nickname.')
        socket.close(1008, 'Join timed out')
      }, JOIN_TIMEOUT_MS),
    }
    session.joinTimeout.unref()
    sessions.set(socket, session)
    socket.on('error', () => socket.terminate())
    socket.on('close', () => removeSession(socket))
    socket.on('pong', () => { session.alive = true })

    socket.on('message', (raw, isBinary) => {
      const now = performance.now()
      if (now - session.windowAt >= 1000) {
        session.windowAt = now
        session.windowMessages = 0
      }
      session.windowMessages += 1
      if (session.windowMessages > MAX_MESSAGES_PER_SECOND) {
        if (session.windowMessages === MAX_MESSAGES_PER_SECOND + 1) {
          error(socket, 'rate_limited', 'Too many messages. Please reconnect.')
          socket.close(1008, 'Message rate exceeded')
        }
        return
      }
      if (isBinary) {
        error(socket, 'invalid_message', 'Send JSON text messages only.')
        return
      }
      let data
      try { data = JSON.parse(raw.toString()) } catch {
        error(socket, 'invalid_message', 'The message was not valid JSON.')
        return
      }
      if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string') {
        error(socket, 'invalid_message', 'The message needs a valid type.')
        return
      }
      if (data.type === 'join') {
        join(session, data)
        return
      }
      if (!session.player) {
        error(socket, 'not_joined', 'Choose a nickname before entering the island.')
        return
      }
      if (data.type === 'move') move(session, data, now)
      else if (data.type === 'chat') chat(session, data, now)
      else if (data.type === 'teleport') teleport(session, data, now)
      else if (data.type === 'honk') {
        if (now - session.lastHonkAt < 1000) {
          error(socket, 'rate_limited', 'Please wait a second before honking again.')
          return
        }
        session.lastHonkAt = now
        broadcast({ type: 'honk', id: session.player.id })
      } else error(socket, 'invalid_message', 'Unknown message type.')
    })
  })

  server.on('upgrade', (request, socket, head) => {
    const reject = (status, reason) => {
      socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    }
    if (!originAllowed(request.headers.origin)) {
      reject(403, 'Forbidden')
      return
    }
    if (closing || sockets.clients.size >= MAX_CONNECTIONS) {
      reject(503, 'Service Unavailable')
      return
    }
    if (request.method !== 'GET' || !['/', '/ws'].includes(request.url?.split('?')[0])) {
      reject(404, 'Not Found')
      return
    }
    sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client, request))
  })

  const stateTimer = setInterval(broadcastState, 1000 / 15)
  stateTimer.unref()
  const heartbeatTimer = setInterval(() => {
    for (const [socket, session] of sessions) {
      if (!session.alive) {
        removeSession(socket)
        socket.terminate()
      } else if (socket.readyState === WebSocket.OPEN) {
        session.alive = false
        socket.ping()
      }
    }
  }, HEARTBEAT_MS)
  heartbeatTimer.unref()

  function shutdown() {
    if (closing) return
    closing = true
    clearInterval(stateTimer)
    clearInterval(heartbeatTimer)
    for (const [socket, session] of sessions) {
      clearTimeout(session.joinTimeout)
      socket.terminate()
    }
    sessions.clear()
    players.clear()
    sockets.close()
  }

  const close = server.close
  server.close = function closeGameServer(callback) {
    shutdown()
    return close.call(this, callback)
  }
  server.on('close', shutdown)
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535')
  const server = createGameServer()
  server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`ROAM multiplayer server listening on port ${port}`)
  })
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      server.close(() => process.exit(0))
      setTimeout(() => process.exit(1), 5000).unref()
    })
  }
}
