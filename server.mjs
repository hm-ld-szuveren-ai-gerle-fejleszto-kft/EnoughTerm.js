import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const distRoot = path.join(appRoot, 'dist');
const options = Object.fromEntries(process.argv.slice(2).flatMap((arg, index, all) => {
  if (!arg.startsWith('--')) return [];
  const [key, inlineValue] = arg.slice(2).split('=', 2);
  return [[key, inlineValue ?? all[index + 1]]];
}));
const host = options.host || process.env.HOST || '127.0.0.1';
const port = Number(options.port || process.env.PORT || 9001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
const normalizeHostname = (hostname) => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
};
const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
const bindHost = normalizeHostname(host);
allowedHosts.add(bindHost);
for (const allowedHost of (process.env.ALLOWED_HOSTS || '').split(',')) {
  if (allowedHost.trim()) allowedHosts.add(normalizeHostname(allowedHost.trim()));
}
const shell = process.env.SHELL || (process.platform === 'win32' ? process.env.COMSPEC || 'powershell.exe' : '/bin/sh');
const homeDirectory = process.env.HOME || process.env.USERPROFILE || process.cwd();
const maxInputChunkBytes = 8 * 1024;
const outputHighWaterMark = 256 * 1024;
const outputResumeMark = 128 * 1024;
const maxPtyCols = 2000;
const maxPtyRows = 500;
const dev = !process.argv.includes('--production') && process.env.NODE_ENV !== 'production';
const devHmrPath = '/__vite_hmr';
let vite;
const server = http.createServer((request, response) => {
  response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  response.setHeader('X-Frame-Options', 'DENY');
  if (dev) return vite.middlewares(request, response, () => { response.statusCode = 404; response.end('Not found'); });
  let pathname;
  try { pathname = new URL(request.url || '/', 'http://localhost').pathname; } catch {
    response.statusCode = 400;
    response.end('Bad request');
    return;
  }
  const file = path.resolve(distRoot, pathname === '/' ? 'index.html' : `.${pathname}`);
  if (!file.startsWith(`${distRoot}${path.sep}`)) { response.statusCode = 404; response.end('Not found'); return; }
  let stats;
  try { stats = statSync(file); } catch {
    response.statusCode = 404;
    response.end('Not found');
    return;
  }
  if (!stats.isFile()) { response.statusCode = 404; response.end('Not found'); return; }
  const mimeTypes = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', woff2: 'font/woff2', woff: 'font/woff' };
  const extension = file.split('.').pop();
  response.setHeader('Content-Type', mimeTypes[extension] || 'application/octet-stream');
  const stream = createReadStream(file);
  stream.on('error', (error) => {
    console.error('Could not serve a static file:', error);
    if (response.headersSent) response.destroy();
    else { response.statusCode = error.code === 'ENOENT' ? 404 : 500; response.end('Could not serve file'); }
  });
  stream.pipe(response);
});
if (dev) {
  vite = await createViteServer({
    root: appRoot,
    server: { middlewareMode: true, allowedHosts: [...allowedHosts], hmr: { server, path: devHmrPath } },
    appType: 'spa',
  });
}
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (request, socket, head) => {
  let pathname;
  try { pathname = new URL(request.url || '/', 'http://localhost').pathname; } catch { socket.destroy(); return; }
  if (pathname !== '/terminal') {
    const protocol = request.headers['sec-websocket-protocol'];
    if (dev && pathname === devHmrPath && ['vite-hmr', 'vite-ping'].includes(protocol)) return;
    socket.destroy();
    return;
  }
  const origin = request.headers.origin;
  let requestHostname;
  try {
    const requestUrl = new URL(`http://${request.headers.host || ''}`);
    if (!requestUrl.username && !requestUrl.password && requestUrl.pathname === '/' && !requestUrl.search && !requestUrl.hash) {
      requestHostname = normalizeHostname(requestUrl.hostname);
    }
  } catch { /* Invalid Host headers are rejected below. */ }
  const localAddress = normalizeHostname(request.socket.localAddress || '');
  let allowedOrigin = allowedHosts.has(requestHostname) || requestHostname === localAddress;
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      allowedOrigin = allowedOrigin
        && !parsedOrigin.username
        && !parsedOrigin.password
        && ['http:', 'https:'].includes(parsedOrigin.protocol)
        && parsedOrigin.host === request.headers.host?.toLowerCase();
    } catch { allowedOrigin = false; }
  }
  if (!allowedOrigin) { socket.destroy(); return; }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});
wss.on('connection', (ws) => {
  let proc;
  try {
    proc = pty.spawn(shell, [], { name: 'xterm-256color', cols: 100, rows: 30, cwd: homeDirectory, env: process.env });
  } catch (error) {
    console.error(`Could not start shell ${shell}:`, error);
    ws.close(1011, 'Unable to start shell');
    return;
  }
  let processExited = false;
  let processStopped = false;
  let processHadOutput = false;
  let pendingOutputBytes = 0;
  let ptyPaused = false;
  const stopShell = () => {
    if (processExited || processStopped) return;
    processStopped = true;
    try { proc.kill(); } catch (error) { console.error('Could not stop shell:', error); }
  };
  proc.onData((data) => {
    processHadOutput = true;
    if (ws.readyState !== ws.OPEN) return;
    const bytes = Buffer.byteLength(data, 'utf8');
    pendingOutputBytes += bytes;
    if (pendingOutputBytes >= outputHighWaterMark && !ptyPaused) {
      ptyPaused = true;
      proc.pause();
    }
    ws.send(JSON.stringify({ type: 'output', data, bytes }), (error) => { if (error) stopShell(); });
  });
  ws.on('message', (raw) => {
    if (processExited || processStopped || ws.readyState !== ws.OPEN) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return;
    try {
      if (msg.type === 'input' && typeof msg.data === 'string' && Buffer.byteLength(msg.data, 'utf8') <= maxInputChunkBytes) proc.write(msg.data);
      if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) proc.resize(Math.max(2, Math.min(msg.cols, maxPtyCols)), Math.max(2, Math.min(msg.rows, maxPtyRows)));
    } catch (error) {
      console.error('Could not update shell:', error);
      stopShell();
      return;
    }
    if (msg.type === 'ack' && Number.isSafeInteger(msg.bytes) && msg.bytes > 0 && msg.bytes <= pendingOutputBytes) {
      pendingOutputBytes -= msg.bytes;
      if (ptyPaused && pendingOutputBytes <= outputResumeMark && !processExited && !processStopped) {
        ptyPaused = false;
        proc.resume();
      }
    }
  });
  ws.on('close', stopShell);
  ws.on('error', stopShell);
  proc.onExit(({ exitCode }) => {
    processExited = true;
    if (ws.readyState === ws.OPEN) {
      if (!processHadOutput && exitCode !== 0) ws.close(1011, 'Shell could not start');
      else ws.close(1000, `Shell exited (${exitCode})`);
    }
  });
});
const displayHost = host.includes(':') ? `[${host.replace(/^\[|\]$/g, '')}]` : host;
server.listen(port, host, () => console.log(`EnoughTerm listening at http://${displayHost}:${port}`));
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  wss.clients.forEach((client) => client.close(1012, 'Server restarting'));
  const httpClose = new Promise((resolve) => server.close(resolve));
  await Promise.allSettled([vite?.close(), httpClose]);
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown(); });
