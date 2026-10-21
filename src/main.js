import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@fontsource/cascadia-mono/400.css';
import '@fontsource/cascadia-mono/600.css';
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
      <div class="terminal-topline"><span class="window-dots"><i></i><i></i><i></i></span><span class="tab-title">Terminal <span class="tab-path">· ~</span></span><span class="kbd-hint">Ctrl+F to search</span><button class="toolbar-button" id="search-toggle" title="Find in terminal (Ctrl+F)" aria-label="Find in terminal"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"></circle><path d="m16 16 4.2 4.2"></path></svg><span>Find</span></button></div>
      <form class="search-bar" id="search-bar" role="search" hidden>
        <input id="search-input" type="search" placeholder="Find in terminal" aria-label="Find in terminal" autocomplete="off" />
        <span class="search-count" id="search-count" aria-live="polite"></span>
        <button type="button" class="search-step" id="search-previous" title="Previous match" aria-label="Previous match">↑</button>
        <button type="button" class="search-step" id="search-next" title="Next match" aria-label="Next match">↓</button>
        <button type="button" class="search-close" id="search-close" title="Close search" aria-label="Close search">×</button>
      </form>
      <div id="terminal"></div>
    </section>
    <footer><span>Interactive local terminal</span><span>Port 9001</span></footer>
  </main>
`;

const status = document.querySelector('#status');
const term = new Terminal({
  cursorBlink: true,
  cursorStyle: 'bar',
  fontFamily: '"Cascadia Mono", monospace',
  fontSize: 14,
  lineHeight: 1.55,
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
term.loadAddon(fit);
term.loadAddon(search);
term.loadAddon(unicode);
term.unicode.activeVersion = '11';
term.loadAddon(new WebLinksAddon((event, uri) => {
  event.preventDefault();
  window.open(uri, '_blank', 'noopener,noreferrer');
}));
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
const searchBar = document.querySelector('#search-bar');
const searchInput = document.querySelector('#search-input');
const searchCount = document.querySelector('#search-count');
function updateSearchCount(result) {
  if (!searchInput.value) { searchCount.textContent = ''; return; }
  searchCount.textContent = result.resultCount ? `${result.resultIndex + 1} of ${result.resultCount}` : 'No matches';
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
document.querySelector('#search-toggle').addEventListener('click', openSearch);
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
term.attachCustomKeyEventHandler((event) => {
  if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    openSearch();
    return false;
  }
  return true;
});
const observer = new ResizeObserver(() => fit.fit());
observer.observe(document.querySelector('#terminal'));
window.addEventListener('beforeunload', () => { intentionalClose = true; socket?.close(); });
