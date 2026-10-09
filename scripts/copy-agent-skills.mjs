import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src', 'server', 'skills');
const destination = path.join(root, 'dist', 'server', 'server', 'skills');

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
