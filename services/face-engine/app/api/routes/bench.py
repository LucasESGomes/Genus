"""
Rotas /bench/* — instrumentação do benchmark de capacidade.

Só são registradas com BENCH_ENDPOINTS=true (ver app/main.py) e continuam
atrás do X-API-Key. Não alteram o pipeline de /recognize: servem para o
cliente de bench (bench/ na raiz do repo) medir o que o `timings_ms` não
enxerga sozinho:

GET  /bench/stats  — contadores de CPU (processo, cgroup, host com steal),
                     memória e cache. O cliente lê antes e depois de cada
                     cenário e calcula CPU-ms por reconhecimento.
POST /bench/reset  — esvazia o cache de embeddings e de DEKs (cenário frio).
POST /bench/micro  — microbench da parte criptográfica, no mesmo caminho de
                     código do /recognize (hex → AES-GCM → cache → comparação),
                     sem rede e sem visão computacional.
"""

import json
import os
import statistics
import time
from pathlib import Path
from typing import Optional

import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(tags=["bench"], prefix="/bench")


# ── Leitura de contadores ────────────────────────────────────────────────────

def _read(path: str) -> Optional[str]:
    try:
        return Path(path).read_text()
    except OSError:
        return None


def _host_cpu() -> Optional[dict]:
    """Linha agregada de /proc/stat em ticks (USER_HZ). Inclui steal."""
    text = _read("/proc/stat")
    if not text:
        return None
    fields = text.splitlines()[0].split()[1:]
    names = ["user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"]
    values = {name: int(fields[i]) for i, name in enumerate(names) if i < len(fields)}
    values["ticks_per_sec"] = os.sysconf("SC_CLK_TCK")
    return values


def _cgroup_cpu_usec() -> Optional[int]:
    """CPU consumida pelo container inteiro (cgroup v2, com fallback v1)."""
    text = _read("/sys/fs/cgroup/cpu.stat")
    if text:
        for line in text.splitlines():
            key, _, value = line.partition(" ")
            if key == "usage_usec":
                return int(value)
    text = _read("/sys/fs/cgroup/cpuacct/cpuacct.usage")  # nanossegundos
    if text:
        return int(text.strip()) // 1000
    return None


def _rss_mb() -> Optional[float]:
    text = _read("/proc/self/status")
    if not text:
        return None
    for line in text.splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) / 1024.0
    return None


def _cpu_info() -> dict:
    text = _read("/proc/cpuinfo") or ""
    model, flags = None, set()
    for line in text.splitlines():
        if model is None and line.startswith("model name"):
            model = line.split(":", 1)[1].strip()
        if not flags and line.startswith("flags"):
            flags = set(line.split(":", 1)[1].split())
    return {
        "model": model,
        "cpu_count": os.cpu_count(),
        "aes_ni": "aes" in flags,
        "avx2": "avx2" in flags,
        "avx512f": "avx512f" in flags,
    }


@router.get("/stats")
async def stats() -> dict:
    from app.core.config import settings
    from app.main import embedding_cache

    mem_total = mem_available = None
    meminfo = _read("/proc/meminfo") or ""
    for line in meminfo.splitlines():
        if line.startswith("MemTotal:"):
            mem_total = int(line.split()[1]) / 1024.0
        elif line.startswith("MemAvailable:"):
            mem_available = int(line.split()[1]) / 1024.0

    cache_stats = embedding_cache.get_stats() if embedding_cache else {}
    return {
        "wall_s": time.monotonic(),
        "process_cpu_s": time.process_time(),
        "cgroup_cpu_usec": _cgroup_cpu_usec(),
        "host_cpu": _host_cpu(),
        "loadavg": list(os.getloadavg()),
        "rss_mb": _rss_mb(),
        "mem_total_mb": mem_total,
        "mem_available_mb": mem_available,
        "cache_tenants": cache_stats.get("total_tenants"),
        "cache_embeddings": cache_stats.get("total_embeddings"),
        "cpu": _cpu_info(),
        "config": {
            "onnx_intra_op_threads": settings.onnx_intra_op_threads,
            "onnx_inter_op_threads": settings.onnx_inter_op_threads,
            "cv2_num_threads": settings.cv2_num_threads,
            "engine_thread_pool_size": settings.engine_thread_pool_size,
            "detection_max_size": settings.detection_max_size,
        },
    }


@router.post("/reset")
async def reset() -> dict:
    from app.main import embedding_cache, dek_manager

    before = embedding_cache.get_stats()["total_embeddings"]
    with embedding_cache._lock:
        embedding_cache._cache.clear()
    with dek_manager._lock:
        dek_manager._dek_cache.clear()
    return {"cleared_embeddings": before}


# ── Microbench de criptografia ───────────────────────────────────────────────

class MicroRequest(BaseModel):
    sizes: list[int] = Field(default=[1, 50, 500, 1000, 5000])
    reps: int = Field(default=5, ge=1, le=50)


def _ms(samples: list[float]) -> dict:
    return {
        "median": round(statistics.median(samples) * 1000.0, 3),
        "min": round(min(samples) * 1000.0, 3),
        "max": round(max(samples) * 1000.0, 3),
    }


def _micro_one(n: int, reps: int) -> dict:
    """Mede, para N candidatos, cada etapa não-visual do /recognize."""
    from app.engine.comparator import FaceComparator
    from app.infra.cache_memory import MemoryEmbeddingCache
    from app.utils.crypto import EmbeddingCrypto

    dek = os.urandom(32)
    master = os.urandom(32)
    aes = AESGCM(dek)

    # Payload no formato exato que o backend envia (hex, um objeto por candidato)
    rng = np.random.default_rng(42)
    vectors = rng.standard_normal((n, 512)).astype(np.float32)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    candidates = []
    for i in range(n):
        iv = os.urandom(12)
        ct_tag = aes.encrypt(iv, vectors[i].tobytes(), None)
        candidates.append({
            "person_id": f"p{i}",
            "embedding_iv": iv.hex(),
            "embedding_tag": ct_tag[-16:].hex(),
            "embedding_ct": ct_tag[:-16].hex(),
            "key_version": 1,
        })
    payload = json.dumps(candidates)

    dek_iv = os.urandom(12)
    dek_ct_tag = AESGCM(master).encrypt(dek_iv, dek, None)
    query = vectors[0]
    comparator = FaceComparator(threshold=1.10)

    t = {k: [] for k in (
        "dek_decrypt", "json_loads", "hex_decode", "aes_gcm_decrypt",
        "decrypt_loop_total", "cache_set", "cache_get_many", "comparison",
    )}

    for _ in range(reps):
        s = time.perf_counter()
        AESGCM(master).decrypt(dek_iv, dek_ct_tag, None)
        t["dek_decrypt"].append(time.perf_counter() - s)

        s = time.perf_counter()
        parsed = json.loads(payload)
        t["json_loads"].append(time.perf_counter() - s)

        # Mesmo laço do /recognize em cache frio, com as subetapas separadas
        crypto = EmbeddingCrypto(dek.hex())
        cache = MemoryEmbeddingCache()
        hex_s = aes_s = set_s = 0.0
        loop_start = time.perf_counter()
        for c in parsed:
            a = time.perf_counter()
            iv = bytes.fromhex(c["embedding_iv"])
            tag = bytes.fromhex(c["embedding_tag"])
            ct = bytes.fromhex(c["embedding_ct"])
            b = time.perf_counter()
            emb = crypto.decrypt_embedding(iv, tag, ct)
            d = time.perf_counter()
            cache.set("bench", c["person_id"], emb)
            e = time.perf_counter()
            hex_s += b - a
            aes_s += d - b
            set_s += e - d
        t["decrypt_loop_total"].append(time.perf_counter() - loop_start)
        t["hex_decode"].append(hex_s)
        t["aes_gcm_decrypt"].append(aes_s)
        t["cache_set"].append(set_s)

        ids = [c["person_id"] for c in parsed]
        s = time.perf_counter()
        cached = cache.get_many("bench", ids)
        t["cache_get_many"].append(time.perf_counter() - s)

        s = time.perf_counter()
        comparator.compare_one_vs_many(
            query, {idx: cached[pid] for idx, pid in enumerate(ids)}, threshold=1.10
        )
        t["comparison"].append(time.perf_counter() - s)

    result = {k: _ms(v) for k, v in t.items()}
    result["payload_bytes"] = len(payload)
    result["aes_gcm_us_per_embedding"] = round(
        statistics.median(t["aes_gcm_decrypt"]) / n * 1e6, 2
    )
    return {"n": n, "stages_ms": result}


@router.post("/micro")
async def micro(request: MicroRequest) -> dict:
    import asyncio
    from app.main import inference_pool

    loop = asyncio.get_running_loop()
    results = []
    for n in request.sizes:
        # No pool de inferência, como o trabalho real: disputa a mesma CPU
        results.append(await loop.run_in_executor(inference_pool, _micro_one, n, request.reps))
    return {"cpu": _cpu_info(), "results": results}
