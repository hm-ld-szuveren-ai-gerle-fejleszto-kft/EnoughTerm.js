# EnoughTerm

A small browser terminal powered by [xterm.js](https://github.com/xtermjs/xterm.js) and a local pseudo-terminal.

The terminal fills the entire page and uses a high contrast light theme, bundled Cascadia Mono, URL detection, inline SIXEL/iTerm images, WebGL rendering with automatic renderer fallback, Unicode 11 character widths, and progress indicators for compatible terminal sequences. Search with `Ctrl+F` or `Cmd+F`. Export the current session as an ANSI text file with `Ctrl/Cmd+Shift+E` (export only; session import is not supported). Use `Ctrl/Cmd` + `+` or `-` to resize text; `Ctrl/Cmd` + `0` restores the default size. xterm.js and the fit addon adapt the terminal grid to the viewport and device pixel ratio.

## Run

```sh
npm install
npm run dev
```

Open <http://localhost:9001>. To make the server reachable from other devices, choose a host and port:

```sh
npm run dev -- --host 0.0.0.0 --port 9001
```

The defaults are `127.0.0.1` and `9001`. `HOST` and `PORT` environment variables are also supported. The system default shell is used; set `SHELL` to override it.

For a production build, run `npm run build` and then `npm run start -- --host 0.0.0.0 --port 9001`.

Only run this on a trusted network when binding to `0.0.0.0`: it provides interactive access to the account's shell.
