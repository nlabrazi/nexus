import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { IncomingMessage } from 'node:http';
import { Duplex } from 'node:stream';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WebSocketServerConnection extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private closed = false;

  constructor(
    private readonly socket: Duplex,
    readonly request: IncomingMessage
  ) {
    super();
    this.socket.on('data', (chunk: Buffer) => this.handleIncomingChunk(chunk));
    this.socket.on('close', () => this.onClose());
    this.socket.on('end', () => this.onClose());
    this.socket.on('error', (err: Error) => {
      this.emit('error', err);
      this.onClose();
    });
  }

  send(data: string): void {
    if (this.closed || !this.socket.writable) {
      return;
    }
    const payload = Buffer.from(data, 'utf-8');
    const length = payload.length;

    let header: Buffer;
    if (length <= 125) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // FIN + text opcode
      header[1] = length;
    } else if (length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this.onClose();
    }
  }

  close(code = 1000): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code, 0);
    const frame = Buffer.concat([Buffer.from([0x88, 2]), body]);
    try {
      this.socket.write(frame);
    } catch {
      // ignore
    }
    this.socket.destroy();
    this.emit('close');
  }

  isOpen(): boolean {
    return !this.closed && this.socket.writable;
  }

  handleIncomingChunk(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processFrames();
  }

  private processFrames(): void {
    while (this.buffer.length >= 2) {
      const byte0 = this.buffer[0];
      const byte1 = this.buffer[1];

      const opcode = byte0 & 0x0f;
      const isMasked = (byte1 & 0x80) !== 0;
      let payloadLength = byte1 & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < 4) {
          return;
        }
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) {
          return;
        }
        payloadLength = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLength = isMasked ? 4 : 0;
      const totalLength = offset + maskLength + payloadLength;
      if (this.buffer.length < totalLength) {
        return;
      }

      let payload = this.buffer.subarray(offset + maskLength, totalLength);
      if (isMasked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.alloc(payloadLength);
        for (let i = 0; i < payloadLength; i++) {
          unmasked[i] = payload[i] ^ mask[i % 4];
        }
        payload = unmasked;
      }

      this.buffer = this.buffer.subarray(totalLength);

      if (opcode === 0x01) {
        // Text frame
        const text = payload.toString('utf-8');
        this.emit('message', text);
      } else if (opcode === 0x08) {
        // Close frame
        this.close();
      } else if (opcode === 0x09) {
        // Ping frame -> respond with Pong
        const pongHeader = Buffer.from([0x8a, payload.length]);
        try {
          this.socket.write(Buffer.concat([pongHeader, payload]));
        } catch {
          this.onClose();
        }
      }
    }
  }

  private onClose(): void {
    if (!this.closed) {
      this.closed = true;
      this.emit('close');
    }
  }
}

export function upgradeHttpToWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
): WebSocketServerConnection | undefined {
  const key = req.headers['sec-websocket-key'];
  if (!key || typeof key !== 'string') {
    socket.destroy();
    return undefined;
  }

  const acceptKey = createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n',
  ];

  socket.write(headers.join('\r\n'));
  const conn = new WebSocketServerConnection(socket, req);
  if (head && head.length > 0) {
    conn.handleIncomingChunk(head);
  }
  return conn;
}
