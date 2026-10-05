// `npm run start:local`: the mock backends plus `ng serve`, stopped together.
// Extra args go to ng serve, e.g. `npm run start:local -- --port 4210`.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (!args.includes('--port')) args.push('--port', '4210');

const kids = [
  spawn(process.execPath, ['mock/server.mjs'], { cwd: root, stdio: 'inherit' }),
  // NG_CLI_ANALYTICS off: the first-run analytics question would otherwise hang
  // a non-interactive launch forever.
  spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve', ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, NG_CLI_ANALYTICS: 'false' } }),
];
const stop = () => { for (const k of kids) if (!k.killed) k.kill(); process.exit(); };
for (const k of kids) k.on('exit', stop);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
