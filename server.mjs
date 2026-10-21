import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';

const options = Object.fromEntries(process.argv.slice(2).flatMap((arg, index, all) => {
  if (!arg.startsWith('--')) return [];
  const [key, inlineValue] = arg.slice(2).split('=', 2);
  return [[key, inlineValue ?? all[index + 1]]];
}));
const host = options.host || process.env.HOST || '127.0.0.1';
const port = Number(options.port || process.env.PORT || 9001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/sh');
const homeDirectory = process.env.HOME || process.env.USERPROFILE || process.cwd();
const dev = !process.argv.includes('--production') && process.env.NODE_ENV !== 'production';
const vite = dev ? await createViteServer({ server: { middlewareMode: true }, appType: 'spa' }) : null;
const server = http.createServer((request, response) => {
  if (dev) return vite.middlewares(request, response, () => { response.statusCode = 404; response.end('Not found'); });
  let path;
  try { path = new URL(request.url || '/', 'http://localhost').pathname; } catch {
    response.statusCode = 400;
    response.end('Bad request');
    return;
  }
  const file = path === '/' ? 'dist/index.html' : `dist${path}`;
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
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin;
  let allowedOrigin = !origin;
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      allowedOrigin = ['http:', 'https:'].includes(parsedOrigin.protocol)
        && parsedOrigin.host === request.headers.host?.toLowerCase();
    } catch { allowedOrigin = false; }
  }
  if (request.url !== '/terminal' || !allowedOrigin) { socket.destroy(); return; }
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
  const stopShell = () => {
    if (processExited) return;
    try { proc.kill(); } catch (error) { console.error('Could not stop shell:', error); }
  };
  proc.onData((data) => { if (ws.readyState === ws.OPEN) ws.send(data); });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'input' && typeof msg.data === 'string' && msg.data.length <= 16_384) proc.write(msg.data);
    if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) proc.resize(Math.max(2, Math.min(msg.cols, 300)), Math.max(2, Math.min(msg.rows, 120)));
  });
  ws.on('close', stopShell);
  ws.on('error', stopShell);
  proc.onExit(({ exitCode }) => {
    processExited = true;
    if (ws.readyState === ws.OPEN) ws.close(1000, `Shell exited (${exitCode})`);
  });
});
server.listen(port, host, () => console.log(`EnoughTerm listening at http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { wss.clients.forEach((client) => client.close()); server.close(() => process.exit(0)); });
