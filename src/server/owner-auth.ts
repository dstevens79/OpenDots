import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const pamHelper = resolve(process.cwd(), 'scripts/authenticate-pam.py');

/** Check a password without saving it or placing it in process arguments. */
export function authenticateLinuxAccount(
  username: string,
  password: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('python3', [pamHelper, username], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.once('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
    child.stdin.end(`${password}\n`);
  });
}
