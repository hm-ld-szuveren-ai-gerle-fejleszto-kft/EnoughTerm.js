import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './style.css';

document.querySelector('#app').innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">⌘</span><span>EnoughTerm</span></div>
      <div class="session"><span class="status-dot"></span><span id="status">Connecting</span><span class="divider"></span><span id="shell-label">Local shell</span></div>
      <button class="icon-button" id="clear" title="Clear terminal" aria-label="Clear terminal">⌫</button>
    </header>
    <section class="terminal-card" aria-label="Terminal">
      <div class="terminal-topline"><span class="window-dots"><i></i><i></i><i></i></span><span class="tab-title">Terminal <span class="tab-path">· ~</span></span><span class="kbd-hint">⌃ C to interrupt</span></div>
      <div id="terminal"></div>
    </section>
    <footer><span>Interactive local terminal</span><span>Port 9001</span></footer>
  </main>
`;

const status = document.querySelector('#status');
const term = new Terminal({
  cursorBlink: true,
  cursorStyle: 'bar',
  fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: 14,
  lineHeight: 1.55,
  scrollback: 5000,
  theme: { background: '#101114', foreground: '#e4e4e7', cursor: '#c4f36b', selectionBackground: '#3b4135', black: '#202126', red: '#ff6b6b', green: '#c4f36b', yellow: '#f6c96b', blue: '#82aaff', magenta: '#d6a8ff', cyan: '#78dce8', white: '#e4e4e7', brightBlack: '#777983', brightWhite: '#ffffff' },
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open(document.querySelector('#terminal'));
fit.fit();
term.focus();

let socket;
let retries = 0;
let intentionalClose = false;
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/terminal`);
  socket.addEventListener('open', () => {
    retries = 0;
    status.textContent = 'Connected';
    status.classList.add('connected');
    socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  });
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') term.write(event.data);
  });
  socket.addEventListener('close', () => {
    status.textContent = 'Disconnected';
    status.classList.remove('connected');
    if (!intentionalClose) setTimeout(connect, Math.min(1000 * 2 ** retries++, 8000));
  });
  socket.addEventListener('error', () => socket.close());
}
connect();
term.onData((data) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data })); });
term.onResize(({ cols, rows }) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows })); });
document.querySelector('#clear').addEventListener('click', () => { term.clear(); term.focus(); });
const observer = new ResizeObserver(() => fit.fit());
observer.observe(document.querySelector('#terminal'));
window.addEventListener('beforeunload', () => { intentionalClose = true; socket?.close(); });
