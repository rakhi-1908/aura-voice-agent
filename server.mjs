import { createServer } from 'node:http';
import nextEnv from '@next/env';
import next from 'next';
import { WebSocket, WebSocketServer } from 'ws';

const { loadEnvConfig } = nextEnv;
const isDev = process.env.NODE_ENV !== 'production' && process.argv.includes('--dev');
const port = Number.parseInt(process.env.PORT || '3000', 10);
const hostname = '0.0.0.0';
const maxPayload = 1024 * 1024;

loadEnvConfig(process.cwd(), isDev);

const app = next({ dev: isDev, hostname, port });
const handleRequest = app.getRequestHandler();

const server = createServer((request, response) => handleRequest(request, response));
const webSocketServer = new WebSocketServer({ noServer: true, maxPayload });

function rejectUpgrade(socket, status, message) {
  socket.write(
    `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`
  );
  socket.destroy();
}

function closePeer(peer, code, reason) {
  if (peer.readyState !== WebSocket.OPEN && peer.readyState !== WebSocket.CONNECTING) return;
  const validCode = code === 1005 || code === 1006 || code === 1015 ? 1000 : code;
  peer.close(validCode, reason.toString().slice(0, 123));
}

server.on('upgrade', (request, socket, head) => {
  let requestUrl;
  try {
    const hostHeader = request.headers['x-forwarded-host'] || request.headers.host || 'localhost';
    const protoHeader = request.headers['x-forwarded-proto'] || 'http';
    requestUrl = new URL(request.url || '/', `${protoHeader}://${hostHeader}`);
  } catch {
    rejectUpgrade(socket, '400 Bad Request', 'Invalid WebSocket request.');
    return;
  }

  if (requestUrl.pathname !== '/api/ws') return;

  const host = (request.headers['x-forwarded-host'] || request.headers.host || '').split(':')[0];
  const origin = request.headers.origin;
  let originHost = '';
  let originProtocol = '';

  try {
    if (origin) {
      const parsedOrigin = new URL(origin);
      originHost = parsedOrigin.hostname;
      originProtocol = parsedOrigin.protocol;
    }
  } catch {
    originHost = '';
    originProtocol = '';
  }

  // Permissive check for same-origin behind Render's reverse proxy
  const isAllowedOrigin =
    !origin ||
    ['http:', 'https:'].includes(originProtocol) &&
    (originHost.toLowerCase() === host.toLowerCase() ||
     originHost.endsWith('.onrender.com') ||
     originHost === 'localhost' ||
     originHost === '127.0.0.1');

  if (!isAllowedOrigin) {
    rejectUpgrade(socket, '403 Forbidden', 'WebSocket origin is not allowed.');
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    rejectUpgrade(socket, '503 Service Unavailable', 'Gemini Live API key is not configured.');
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (client) => {
    const upstreamUrl = new URL(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
    );
    upstreamUrl.searchParams.set('key', apiKey);

    const upstream = new WebSocket(upstreamUrl, { maxPayload, handshakeTimeout: 15000 });
    const pendingMessages = [];
    let pendingBytes = 0;

    client.on('message', (data, isBinary) => {
      const byteLength = Array.isArray(data)
        ? data.reduce((total, chunk) => total + chunk.length, 0)
        : data.byteLength;

      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else if (
        upstream.readyState === WebSocket.CONNECTING &&
        pendingBytes + byteLength <= maxPayload
      ) {
        pendingMessages.push({ data, isBinary });
        pendingBytes += byteLength;
      } else {
        client.close(1013, 'Upstream connection not ready.');
      }
    });

    upstream.on('open', () => {
      for (const message of pendingMessages) {
        if (client.readyState !== WebSocket.OPEN) break;
        upstream.send(message.data, { binary: message.isBinary });
      }
      pendingMessages.length = 0;
      pendingBytes = 0;
    });

    upstream.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: isBinary });
      }
    });

    client.on('close', (code, reason) => closePeer(upstream, code, reason));
    upstream.on('close', (code, reason) => closePeer(client, code, reason));
    upstream.on('error', (error) => {
      console.error('Gemini Live WebSocket proxy error:', error.message);
      if (client.readyState === WebSocket.OPEN) {
        client.close(1011, 'Gemini Live connection failed.');
      }
    });
  });
});

await app.prepare();

server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port} (${isDev ? 'development' : 'production'})`);
});