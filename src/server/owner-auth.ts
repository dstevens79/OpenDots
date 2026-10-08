import { scrypt, timingSafeEqual } from 'node:crypto';

/** Check an installer-created scrypt hash without saving the password. */
export async function authenticateOwnerPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const [algorithm, cost, saltHex, hashHex, extra] = encodedHash.split('$');
  if (
    algorithm !== 'scrypt' ||
    cost !== '16384' ||
    !saltHex ||
    !hashHex ||
    extra !== undefined ||
    !/^[0-9a-f]{32}$/.test(saltHex) ||
    !/^[0-9a-f]{64}$/.test(hashHex)
  )
    return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      32,
      { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    ),
  );
  return timingSafeEqual(actual, expected);
}
