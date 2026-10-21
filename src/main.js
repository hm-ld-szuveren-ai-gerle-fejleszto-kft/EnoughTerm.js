import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import { WebglAddon } from '@xterm/addon-webgl';
import { SerializeAddon } from '@xterm/addon-serialize';
import { ProgressAddon } from '@xterm/addon-progress';
import '@fontsource/cascadia-mono/400.css';
import '@fontsource/cascadia-mono/600.css';
import '@xterm/xterm/css/xterm.css';
import './style.css';

document.querySelector('#app').innerHTML = `
  <main id="terminal" aria-label="Interactive terminal"></main>
  <div class="connection-status" id="connection-status" role="status" aria-live="polite">Connecting to the local shell…</div>
  <div class="progress-indicator" id="progress-indicator" role="status" aria-live="polite" hidden>
    <span class="progress-label" id="progress-label"></span>
    <span class="progress-track"><span class="progress-value" id="progress-value"></span></span>
  </div>
  <div class="status-toast" id="status-toast" role="status" aria-live="polite" hidden></div>
  <form class="search-bar" id="search-bar" role="search" aria-label="Find in terminal" hidden>
    <input id="search-input" type="search" placeholder="Find in terminal" aria-label="Find in terminal" autocomplete="off" />
    <span class="search-count" id="search-count" aria-live="polite"></span>
    <button type="button" class="search-step" id="search-previous" title="Previous match" aria-label="Previous match">↑</button>
    <button type="button" class="search-step" id="search-next" title="Next match" aria-label="Next match">↓</button>
    <button type="button" class="search-close" id="search-close" title="Close search" aria-label="Close search">×</button>
  </form>
`;

let fontSize = 16;
const term = new Terminal({
  cursorBlink: true,
  cursorStyle: 'bar',
  fontFamily: '"Cascadia Mono", monospace',
  fontSize,
  lineHeight: 1.45,
  scrollback: 5000,
  theme: {
    background: '#ffffff', foreground: '#161b22', cursor: '#163c77', cursorAccent: '#ffffff', selectionBackground: '#c5dcff', selectionForeground: '#111827',
    black: '#24292f', red: '#a40e26', green: '#116329', yellow: '#795000', blue: '#0645ad', magenta: '#762a83', cyan: '#006a75', white: '#57606a',
    brightBlack: '#6e7781', brightRed: '#cf222e', brightGreen: '#1a7f37', brightYellow: '#9a6700', brightBlue: '#0969da', brightMagenta: '#8250df', brightCyan: '#0550ae', brightWhite: '#161b22',
  },
});
const fit = new FitAddon();
const search = new SearchAddon({ highlightLimit: 1000 });
const unicode = new Unicode11Addon();
const images = new ImageAddon({ pixelLimit: 16_777_216, storageLimit: 64 });
const serialize = new SerializeAddon();
const progress = new ProgressAddon();
term.loadAddon(fit);
term.loadAddon(search);
term.loadAddon(unicode);
term.loadAddon(images);
term.loadAddon(serialize);
term.loadAddon(progress);
term.unicode.activeVersion = '11';
function openHttpLink(event, uri) {
  let target;
  try { target = new URL(uri, location.href); } catch { return; }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return;
  event.preventDefault();
  window.open(target.href, '_blank', 'noopener,noreferrer');
}
term.options.linkHandler = { allowNonHttpProtocols: false, activate: openHttpLink };
term.loadAddon(new WebLinksAddon(openHttpLink));
term.open(document.querySelector('#terminal'));
try {
  const webgl = new WebglAddon();
  webgl.onContextLoss(() => webgl.dispose());
  term.loadAddon(webgl);
} catch (error) {
  console.info('WebGL renderer unavailable; using the standard renderer.', error);
}
term.focus();
const connectionStatus = document.querySelector('#connection-status');

const progressIndicator = document.querySelector('#progress-indicator');
const progressLabel = document.querySelector('#progress-label');
const progressValue = document.querySelector('#progress-value');
progress.onChange(({ state, value }) => {
  progressIndicator.hidden = state === 0;
  progressIndicator.dataset.state = String(state);
  progressValue.style.width = `${state === 3 ? 35 : value}%`;
  progressLabel.textContent = state === 3 ? 'Working…' : state === 2 ? `Error · ${value}%` : state === 4 ? `Paused · ${value}%` : `${value}%`;
  progressIndicator.setAttribute('aria-label', progressLabel.textContent);
});
let toastTimer;
function showToast(message) {
  const toast = document.querySelector('#status-toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}
function exportSession() {
  const content = serialize.serialize();
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `enoughterm-session-${new Date().toISOString().replace(/[:.]/g, '-')}.ansi`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Terminal session exported as ANSI text');
}

function fitTerminal() {
  requestAnimationFrame(() => {
    fit.fit();
    if (term.rows > 0) term.refresh(0, term.rows - 1);
  });
}
document.fonts.ready.then(fitTerminal);
fitTerminal();

let socket;
let retries = 0;
let intentionalClose = false;
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/terminal`);
  socket.addEventListener('open', () => {
    retries = 0;
    connectionStatus.textContent = 'Connected · waiting for shell output…';
    connectionStatus.hidden = false;
    socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  });
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      let packet;
      try { packet = JSON.parse(event.data); } catch { packet = { type: 'output', data: event.data }; }
      if (packet.type !== 'output' || typeof packet.data !== 'string') return;
      connectionStatus.hidden = true;
      term.write(packet.data, () => {
        if (socket?.readyState === WebSocket.OPEN && Number.isInteger(packet.bytes) && packet.bytes > 0) {
          socket.send(JSON.stringify({ type: 'ack', bytes: packet.bytes }));
        }
      });
    }
  });
  socket.addEventListener('close', (event) => {
    if (intentionalClose) return;
    if (event.code === 1000) {
      connectionStatus.textContent = 'Shell exited · reload to start another session.';
      connectionStatus.hidden = false;
      return;
    }
    if (event.code === 1011) {
      connectionStatus.textContent = 'Shell could not start · check the server configuration.';
      connectionStatus.hidden = false;
      return;
    }
    connectionStatus.textContent = 'Shell connection lost · reconnecting…';
    connectionStatus.hidden = false;
    setTimeout(connect, Math.min(1000 * 2 ** retries++, 8000));
  });
  socket.addEventListener('error', () => socket.close());
}
connect();
function sendTerminalInput(data) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  let chunk = '';
  let chunkBytes = 0;
  for (const character of data) {
    const codePoint = character.codePointAt(0);
    const characterBytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (chunk && chunkBytes + characterBytes > 8 * 1024) {
      socket.send(JSON.stringify({ type: 'input', data: chunk }));
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk) socket.send(JSON.stringify({ type: 'input', data: chunk }));
}
term.onData(sendTerminalInput);
term.onResize(({ cols, rows }) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows })); });
const searchBar = document.querySelector('#search-bar');
const searchInput = document.querySelector('#search-input');
const searchCount = document.querySelector('#search-count');
function updateSearchCount(result) {
  if (!searchInput.value) { searchCount.textContent = ''; return; }
  searchCount.textContent = result.resultCount ? `${result.resultIndex >= 0 ? result.resultIndex + 1 : 'Many'} of ${result.resultCount}` : 'No matches';
}
search.onDidChangeResults(updateSearchCount);
function openSearch() {
  searchBar.hidden = false;
  searchInput.focus();
  searchInput.select();
}
function searchFor(direction = 'next') {
  const query = searchInput.value;
  if (!query) { search.clearDecorations(); searchCount.textContent = ''; return; }
  const options = { incremental: direction === 'next', decorations: { matchBackground: '#ffeb99', matchBorder: '#8a5a00', matchOverviewRuler: '#8a5a00', activeMatchBackground: '#ffd966', activeMatchBorder: '#573900', activeMatchColorOverviewRuler: '#573900' } };
  const found = direction === 'previous' ? search.findPrevious(query, options) : search.findNext(query, options);
  if (!found) searchCount.textContent = 'No matches';
}
document.querySelector('#search-close').addEventListener('click', () => {
  searchBar.hidden = true;
  search.clearDecorations();
  searchInput.value = '';
  searchCount.textContent = '';
  term.focus();
});
document.querySelector('#search-next').addEventListener('click', () => searchFor('next'));
document.querySelector('#search-previous').addEventListener('click', () => searchFor('previous'));
searchInput.addEventListener('input', () => searchFor('next'));
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); searchFor(event.shiftKey ? 'previous' : 'next'); }
  if (event.key === 'Escape') document.querySelector('#search-close').click();
});
window.addEventListener('keydown', (event) => {
  if (event.type !== 'keydown' || (!event.ctrlKey && !event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (event.shiftKey && key === 'e') {
    event.preventDefault();
    event.stopImmediatePropagation();
    exportSession();
    return;
  }
  if (key === 'f') {
    event.preventDefault();
    event.stopImmediatePropagation();
    openSearch();
    return;
  }
  if (key === '+' || key === '=' || key === '-' || key === '_') {
    event.preventDefault();
    fontSize = Math.max(11, Math.min(30, fontSize + (key === '-' || key === '_' ? -1 : 1)));
    term.options.fontSize = fontSize;
    fitTerminal();
  } else if (key === '0') {
    event.preventDefault();
    fontSize = 16;
    term.options.fontSize = fontSize;
    fitTerminal();
  }
}, { capture: true });
const observer = new ResizeObserver(fitTerminal);
observer.observe(document.querySelector('#terminal'));
window.addEventListener('resize', fitTerminal, { passive: true });
window.visualViewport?.addEventListener('resize', fitTerminal, { passive: true });
function watchDevicePixelRatio() {
  const density = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  density.addEventListener('change', () => { fitTerminal(); watchDevicePixelRatio(); }, { once: true });
}
watchDevicePixelRatio();
window.addEventListener('beforeunload', () => { intentionalClose = true; socket?.close(); });
