import { chmod, readdir } from 'node:fs/promises';
import path from 'node:path';

const prebuilds = path.join('node_modules', 'node-pty', 'prebuilds');
try {
  for (const platform of await readdir(prebuilds, { withFileTypes: true })) {
    if (!platform.isDirectory()) continue;
    const helper = path.join(prebuilds, platform.name, 'spawn-helper');
    try { await chmod(helper, 0o755); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
