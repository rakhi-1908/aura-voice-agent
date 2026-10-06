import { createServer } from 'node:http';
import nextEnv from '@next/env';
import next from 'next';
import { WebSocket, WebSocketServer } from 'ws';

const { loadEnvConfig } = nextEnv;
const isDev = process.argv.includes('--dev');
const port = Number.parseInt(process.env.PORT || '3000', 10);
const hostname = process.env.HOSTNAME || '0.0.0.0';
const maxPayload = 1024 * 1024;

loadEnvConfig(process.cwd(), isDev);

let handleRequest;
const server = createServer((request, response) => handleRequest(request, response));
const app = next({ dev: isDev, hostname, port, webpack: isDev, httpServer: server });
handleRequest = app.getRequestHandler();
const webSocketServer = new WebSocketServer({ noServer: true, maxPayload });

function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
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
    requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  } catch {
    rejectUpgrade(socket, '400 Bad Request', 'Invalid WebSocket request.');
    return;
  }

  if (requestUrl.pathname !== '/api/ws') return;

  const host = request.headers.host;
  const origin = request.headers.origin;
  let originHost = '';
  let originProtocol = '';
  try {
    const parsedOrigin = origin ? new URL(origin) : null;
    originHost = parsedOrigin?.host || '';
    originProtocol = parsedOrigin?.protocol || '';
  } catch {
    originHost = '';
    originProtocol = '';
  }
  if (!host || !['http:', 'https:'].includes(originProtocol) || originHost.toLowerCase() !== host.toLowerCase()) {
    rejectUpgrade(socket, '403 Forbidden', 'WebSocket origin is not allowed.');
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    rejectUpgrade(socket, '503 Service Unavailable', 'Gemini Live is not configured on this server.');
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (client) => {
    const upstreamUrl = new URL('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent');
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
      } else if (upstream.readyState === WebSocket.CONNECTING && pendingBytes + byteLength <= maxPayload) {
        pendingMessages.push({ data, isBinary });
        pendingBytes += byteLength;
      } else {
        client.close(1013, 'Upstream is not ready.');
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
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });

    client.on('close', (code, reason) => closePeer(upstream, code, reason));
    upstream.on('close', (code, reason) => closePeer(client, code, reason));
    upstream.on('error', (error) => {
      console.error('Gemini WebSocket proxy error:', error.message);
      if (client.readyState === WebSocket.OPEN) client.close(1011, 'Gemini Live connection failed.');
    });
  });
});

await app.prepare();
server.listen(port, hostname, () => {
  console.log(`> Server listening at http://${hostname}:${port} (${isDev ? 'development' : 'production'})`);
});