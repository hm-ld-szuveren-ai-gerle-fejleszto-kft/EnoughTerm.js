import http from 'node:http';
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
const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
const dev = !process.argv.includes('--production') && process.env.NODE_ENV !== 'production';
const vite = dev ? await createViteServer({ server: { middlewareMode: true }, appType: 'spa' }) : null;
const server = http.createServer((request, response) => {
  if (dev) return vite.middlewares(request, response, () => { response.statusCode = 404; response.end('Not found'); });
  import('node:fs').then(({ createReadStream, existsSync }) => {
    const path = new URL(request.url, `http://${host}:${port}`).pathname;
    const file = path === '/' ? 'dist/index.html' : `dist${path}`;
    if (!existsSync(file)) { response.statusCode = 404; response.end('Not found'); return; }
    response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream');
    createReadStream(file).pipe(response);
  });
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin;
  if (request.url !== '/terminal' || (origin && new URL(origin).host !== request.headers.host)) { socket.destroy(); return; }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});
wss.on('connection', (ws) => {
  const proc = pty.spawn(shell, [], { name: 'xterm-256color', cols: 100, rows: 30, cwd: process.env.HOME, env: process.env });
  proc.onData((data) => { if (ws.readyState === ws.OPEN) ws.send(data); });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'input' && typeof msg.data === 'string' && msg.data.length <= 16_384) proc.write(msg.data);
    if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) proc.resize(Math.max(2, Math.min(msg.cols, 300)), Math.max(2, Math.min(msg.rows, 120)));
  });
  ws.on('close', () => proc.kill());
  ws.on('error', () => proc.kill());
  proc.onExit(() => { if (ws.readyState === ws.OPEN) ws.close(); });
});
server.listen(port, host, () => console.log(`EnoughTerm listening at http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { wss.clients.forEach((client) => client.close()); server.close(() => process.exit(0)); });
