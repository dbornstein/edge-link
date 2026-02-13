import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const viteBin = resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
const pidFile = resolve(process.cwd(), '.dev-server.pid');

const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

writeFileSync(pidFile, String(child.pid));

const cleanup = () => {
  try { unlinkSync(pidFile); } catch {}
};

child.on('exit', (code, signal) => {
  cleanup();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

const forward = sig => () => child.kill(sig);
process.on('SIGINT', forward('SIGINT'));
process.on('SIGTERM', forward('SIGTERM'));
process.on('exit', cleanup);
