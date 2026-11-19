"""
Verificador de compatibilidade cripto TS <-> engine. Usa as classes REAIS do face-engine.
Entrada (stdin, JSON): {"mode": "decrypt"|"encrypt", ...}. Saida (stdout, JSON).
O sys.path deve conter services/face-engine (cwd ou PYTHONPATH).
"""
import json
import os
import sys

import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.services.dek_manager import DEKManager
from app.utils.crypto import EmbeddingCrypto


def main() -> None:
    req = json.load(sys.stdin)
    master = req["masterKeyHex"]
    if req["mode"] == "decrypt":
        d = req["dek"]
        dek = DEKManager(master).decrypt_dek(
            "t", d["ciphertextHex"], d["ivHex"], d["tagHex"], d["keyVersion"]
        )
        e = req["embedding"]
        vec = EmbeddingCrypto(dek.hex()).decrypt_embedding(
            bytes.fromhex(e["ivHex"]), bytes.fromhex(e["tagHex"]), bytes.fromhex(e["ciphertextHex"])
        )
        json.dump({"dekHex": dek.hex(), "vector": [float(x) for x in vec]}, sys.stdout)
    else:
        dek = os.urandom(32)
        iv = os.urandom(12)
        ct_tag = AESGCM(bytes.fromhex(master)).encrypt(iv, dek, None)
        vec = np.random.default_rng(7).standard_normal(512).astype(np.float32)
        vec = vec / np.linalg.norm(vec)
        eiv, etag, ect = EmbeddingCrypto(dek.hex()).encrypt_embedding(vec)
        json.dump(
            {
                "dek": {
                    "ivHex": iv.hex(),
                    "tagHex": ct_tag[-16:].hex(),
                    "ciphertextHex": ct_tag[:-16].hex(),
                    "keyVersion": 1,
                },
                "dekHex": dek.hex(),
                "embedding": {
                    "ivHex": eiv.hex(),
                    "tagHex": etag.hex(),
                    "ciphertextHex": ect.hex(),
                    "keyVersion": 1,
                },
                "vector": [float(x) for x in vec],
            },
            sys.stdout,
        )


main()
