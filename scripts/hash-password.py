#!/usr/bin/env python3
"""Read an OpenDots owner password from stdin and print its salted scrypt hash."""

import hashlib
import secrets
import sys

password = sys.stdin.buffer.readline(4097).rstrip(b"\r\n")
if not 8 <= len(password) <= 4096:
    sys.exit("Password must be between 8 and 4096 bytes.")
salt = secrets.token_bytes(16)
derived = hashlib.scrypt(password, salt=salt, n=16384, r=8, p=1, dklen=32)
print(f"scrypt$16384${salt.hex()}${derived.hex()}")
