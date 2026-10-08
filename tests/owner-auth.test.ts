import { randomBytes, scryptSync } from 'node:crypto';
import { expect, it } from 'vitest';
import { authenticateOwnerPassword } from '../src/server/owner-auth.js';

it('checks an installer-created scrypt owner password hash', async () => {
  const salt = randomBytes(16);
  const derived = scryptSync('correct horse battery staple', salt, 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const encoded = `scrypt$16384$${salt.toString('hex')}$${derived.toString('hex')}`;

  await expect(
    authenticateOwnerPassword('correct horse battery staple', encoded),
  ).resolves.toBe(true);
  await expect(
    authenticateOwnerPassword('wrong password', encoded),
  ).resolves.toBe(false);
  await expect(authenticateOwnerPassword('password', 'invalid')).resolves.toBe(
    false,
  );
});
