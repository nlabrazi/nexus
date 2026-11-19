import * as assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { suite, test } from 'node:test'
import { upgradeHttpToWebSocket, WebSocketServerConnection } from '../../daemon/ws-connection'

class FakeSocket extends EventEmitter {
  writable = true
  destroyed = false
  written: Buffer[] = []
  throwOnWrite = false

  write(chunk: string | Buffer): boolean {
    if (this.throwOnWrite) {
      throw new Error('write failed')
    }
    this.written.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : Buffer.from(chunk))
    return true
  }

  destroy(): this {
    this.destroyed = true
    this.writable = false
    return this
  }
}

function encodeClientFrame(opcode: number, payload: Buffer, masked = true): Buffer {
  const maskBit = masked ? 0x80 : 0
  let header: Buffer
  if (payload.length <= 125) {
    header = Buffer.from([0x80 | opcode, maskBit | payload.length])
  } else if (payload.length <= 65535) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = maskBit | 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = maskBit | 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }

  if (!masked) {
    return Buffer.concat([header, payload])
  }

  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78])
  const body = Buffer.alloc(payload.length)
  for (let i = 0; i < payload.length; i++) {
    body[i] = payload[i] ^ mask[i % 4]
  }
  return Buffer.concat([header, mask, body])
}

suite('WebSocketServerConnection and upgradeHttpToWebSocket', () => {
  test('upgradeHttpToWebSocket rejects missing sec-websocket-key and accepts valid handshake with head frame', () => {
    const badSocket = new FakeSocket()
    const badReq = { headers: {} } as IncomingMessage
    const rejected = upgradeHttpToWebSocket(badReq, badSocket as unknown as Duplex, Buffer.alloc(0))
    assert.equal(rejected, undefined)
    assert.equal(badSocket.destroyed, true)

    const socket = new FakeSocket()
    const key = 'dGhlIHNhbXBsZSBub25jZQ=='
    const expectedAccept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    const req = { headers: { 'sec-websocket-key': key } } as IncomingMessage
    const headFrame = encodeClientFrame(0x01, Buffer.from('hello-head', 'utf-8'), true)

    const conn = upgradeHttpToWebSocket(req, socket as unknown as Duplex, headFrame)
    assert.ok(conn)
    assert.equal(conn.isOpen(), true)
    assert.ok(socket.written[0].toString('utf-8').includes('HTTP/1.1 101 Switching Protocols'))
    assert.ok(
      socket.written[0].toString('utf-8').includes(`Sec-WebSocket-Accept: ${expectedAccept}`),
    )

    conn.close()
    assert.equal(conn.isOpen(), false)
  })

  test('send encodes short, medium (16-bit) and large (64-bit) text frames and handles closed/error sockets', () => {
    const socket = new FakeSocket()
    const conn = new WebSocketServerConnection(socket as unknown as Duplex, {} as IncomingMessage)

    conn.send('hi')
    assert.equal(socket.written[0][0], 0x81)
    assert.equal(socket.written[0][1], 2)
    assert.equal(socket.written[0].subarray(2).toString('utf-8'), 'hi')

    const medium = 'm'.repeat(300)
    conn.send(medium)
    assert.equal(socket.written[1][1], 126)
    assert.equal(socket.written[1].readUInt16BE(2), 300)

    const large = 'L'.repeat(70_000)
    conn.send(large)
    assert.equal(socket.written[2][1], 127)
    assert.equal(Number(socket.written[2].readBigUInt64BE(2)), 70_000)

    socket.writable = false
    const countBefore = socket.written.length
    conn.send('ignored-not-writable')
    assert.equal(socket.written.length, countBefore)

    socket.writable = true
    socket.throwOnWrite = true
    let closedCount = 0
    conn.on('close', () => {
      closedCount += 1
    })
    conn.send('triggers-write-error')
    assert.equal(closedCount, 1)
    assert.equal(conn.isOpen(), false)

    // Subsequent send and close are no-ops
    conn.send('ignored-closed')
    conn.close()
    assert.equal(closedCount, 1)
  })

  test('decodes masked, unmasked, 16-bit, 64-bit and fragmented incoming frames', () => {
    const socket = new FakeSocket()
    const conn = new WebSocketServerConnection(socket as unknown as Duplex, {} as IncomingMessage)
    const received: string[] = []
    conn.on('message', (msg: string) => received.push(msg))

    // Masked short frame delivered in two partial chunks
    const maskedFrame = encodeClientFrame(0x01, Buffer.from('bonjour', 'utf-8'), true)
    socket.emit('data', maskedFrame.subarray(0, 3))
    assert.equal(received.length, 0)
    socket.emit('data', maskedFrame.subarray(3))
    assert.deepEqual(received, ['bonjour'])

    // Unmasked 16-bit frame with partial length header
    const mediumText = 'x'.repeat(200)
    const mediumFrame = encodeClientFrame(0x01, Buffer.from(mediumText, 'utf-8'), false)
    socket.emit('data', mediumFrame.subarray(0, 2))
    assert.equal(received.length, 1)
    socket.emit('data', mediumFrame.subarray(2))
    assert.equal(received[1], mediumText)

    // Unmasked 64-bit frame with partial length header
    const largeText = 'y'.repeat(66_000)
    const largeFrame = encodeClientFrame(0x01, Buffer.from(largeText, 'utf-8'), false)
    socket.emit('data', largeFrame.subarray(0, 5))
    assert.equal(received.length, 2)
    socket.emit('data', largeFrame.subarray(5))
    assert.equal(received[2], largeText)
  })

  test('handles ping/pong, close frame, socket errors and close write failure gracefully', () => {
    const socket = new FakeSocket()
    const conn = new WebSocketServerConnection(socket as unknown as Duplex, {} as IncomingMessage)

    // Ping -> Pong
    socket.emit('data', encodeClientFrame(0x09, Buffer.from('ping', 'utf-8'), true))
    assert.equal(socket.written[0][0], 0x8a)
    assert.equal(socket.written[0].subarray(2).toString('utf-8'), 'ping')

    // Close frame triggers close and emits 'close'
    let closeEvents = 0
    conn.on('close', () => {
      closeEvents += 1
    })
    socket.emit('data', encodeClientFrame(0x08, Buffer.alloc(0), true))
    assert.equal(closeEvents, 1)
    assert.equal(socket.destroyed, true)

    // Ping write failure closes connection
    const failSocket = new FakeSocket()
    const failConn = new WebSocketServerConnection(
      failSocket as unknown as Duplex,
      {} as IncomingMessage,
    )
    let failClosed = 0
    failConn.on('close', () => {
      failClosed += 1
    })
    failSocket.throwOnWrite = true
    failSocket.emit('data', encodeClientFrame(0x09, Buffer.from('p', 'utf-8'), false))
    assert.equal(failClosed, 1)

    // Socket error emits error and closes; close() swallows write throw
    const errSocket = new FakeSocket()
    const errConn = new WebSocketServerConnection(
      errSocket as unknown as Duplex,
      {} as IncomingMessage,
    )
    const errors: Error[] = []
    errConn.on('error', (err: Error) => errors.push(err))
    errSocket.emit('error', new Error('reset by peer'))
    assert.equal(errors.length, 1)
    assert.equal(errConn.isOpen(), false)

    const throwCloseSocket = new FakeSocket()
    const throwCloseConn = new WebSocketServerConnection(
      throwCloseSocket as unknown as Duplex,
      {} as IncomingMessage,
    )
    throwCloseSocket.throwOnWrite = true
    throwCloseConn.close(1001)
    assert.equal(throwCloseSocket.destroyed, true)
  })
})
