"""Recalcula o hash do vetor de ouro com hashlib (independente do TS). Imprime o hex."""
import hashlib

s = "|".join([
    "42", "7", "2026-11-20T12:00:00.123Z", "12345678901",
    "2026-11-20T12:00:01.456Z", "01", "false", "00" * 32,
])
print(hashlib.sha256(s.encode("utf-8")).hexdigest())
