"""
Benchmark de capacidade da face engine.

Roda no seu PC e chama a engine de bench (deploy com BENCH_ENDPOINTS=true)
direto pela API. Comandos, na ordem de uso:

    python bench.py init                  # gera chaves + engine.env para colar no EasyPanel
    python bench.py set-url https://...    # URL pública da engine de bench
    python bench.py check                 # health + perfil da VPS
    python bench.py capture --count 40    # frames da webcam (640px, JPEG q85, como o totem)
    python bench.py enroll                # registra seu rosto via /embeddings/register
    python bench.py gen --n 20000         # distratores cifrados (a "tonelada de embeddings")
    python bench.py micro                 # S1: custo da criptografia isolada, dentro da VPS
    python bench.py seq --n 1,50,100,240  # S2: sequencial por tamanho de candidatos
    python bench.py seq --n 240 --cold    # S5: cache frio (decifra todos a cada request)
    python bench.py conc --levels 1,2,4,8 # S3: concorrência → teto de reconhecimentos/s
    python bench.py burst --total 1000    # S4: 1000 reconhecimentos disparados de uma vez
    python bench.py report                # results/report.html

Cada cenário lê /bench/stats antes e depois e calcula a CPU gasta pela engine
por reconhecimento — o número que define a capacidade numa vCPU,
independente da velocidade da sua internet.
"""

import argparse
import asyncio
import glob
import json
import os
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx
import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).parent
SECRETS = ROOT / ".secrets.json"
ENGINE_ENV = ROOT / "engine.env"
DATA = ROOT / "data"
FRAMES = ROOT / "frames"
RESULTS = ROOT / "results"

ENROLL_FRAMES = 5  # /embeddings/register aceita até 5
# Limite padrão do Starlette por campo de formulário multipart (max_part_size)
MAX_FORM_PART = 1024 * 1024


# ── Configuração ─────────────────────────────────────────────────────────────

def load_secrets() -> dict:
    if not SECRETS.exists():
        sys.exit("Rode `python bench.py init` primeiro.")
    return json.loads(SECRETS.read_text())


def save_secrets(s: dict) -> None:
    SECRETS.write_text(json.dumps(s, indent=2))


def cmd_init(args) -> None:
    if SECRETS.exists() and not args.force:
        sys.exit(f"{SECRETS.name} já existe. Use --force para gerar chaves novas "
                 "(os embeddings já gerados deixam de valer).")
    master = os.urandom(32)
    dek = os.urandom(32)
    dek_iv = os.urandom(12)
    ct_tag = AESGCM(master).encrypt(dek_iv, dek, None)
    s = {
        "engine_url": None,
        "api_key": os.urandom(24).hex(),
        "master_key": master.hex(),
        "tenant_id": "bench-tenant",
        "dek_hex": dek.hex(),
        "dek_ct": ct_tag[:-16].hex(),
        "dek_iv": dek_iv.hex(),
        "dek_tag": ct_tag[-16:].hex(),
    }
    save_secrets(s)
    # Mesmos valores da engine da visage em produção; threads ficam no default
    # da imagem (1), que é o que roda hoje na VPS de 1 vCPU
    ENGINE_ENV.write_text(
        f"MASTER_KEY={s['master_key']}\n"
        f"ENGINE_API_KEY={s['api_key']}\n"
        "BENCH_ENDPOINTS=true\n"
        "PORT=8001\n"
        "RECOGNITION_THRESHOLD=1.10\n"
        "LIVENESS_THRESHOLD=0.85\n"
        "LIVENESS_MODEL_V1_PATH=./models/2.7_80x80_MiniFASNetV1.onnx\n"
        "LIVENESS_MODEL_V2_PATH=./models/4_0_80x80_MiniFASNetV2.onnx\n"
        "DEK_CACHE_TTL_HOURS=1\n"
    )
    print(f"Chaves de bench geradas em {SECRETS}")
    print(f"Variáveis da engine em {ENGINE_ENV} — cole o conteúdo na aba Environment do serviço.")


def cmd_set_url(args) -> None:
    s = load_secrets()
    s["engine_url"] = args.url.rstrip("/")
    save_secrets(s)
    print(f"engine_url = {s['engine_url']}")


def client(s: dict, timeout: float = 60.0, max_conn: int = 100) -> httpx.AsyncClient:
    if not s.get("engine_url"):
        sys.exit("Defina a URL: python bench.py set-url https://...")
    return httpx.AsyncClient(
        base_url=s["engine_url"],
        headers={"X-API-Key": s["api_key"]},
        timeout=timeout,
        limits=httpx.Limits(max_connections=max_conn, max_keepalive_connections=max_conn),
    )


def dek_fields(s: dict) -> dict:
    return {
        "dek_ct": s["dek_ct"],
        "dek_iv": s["dek_iv"],
        "dek_tag": s["dek_tag"],
        "dek_key_version": "1",
    }


# ── Dados ────────────────────────────────────────────────────────────────────

def cmd_capture(args) -> None:
    import cv2

    out = FRAMES / args.label
    out.mkdir(parents=True, exist_ok=True)
    cam = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY)
    cam.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cam.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    if not cam.isOpened():
        sys.exit("Não abri a webcam (tente --camera 1).")

    print(f"Capturando {args.count} frames a cada {args.interval}s. "
          "Olhe para a câmera e mexa levemente a cabeça. ESC cancela.")
    saved, last = 0, 0.0
    while saved < args.count:
        ok, frame = cam.read()
        if not ok:
            continue
        cv2.imshow("bench capture", frame)
        if cv2.waitKey(1) == 27:
            break
        now = time.time()
        if now - last < args.interval:
            continue
        last = now
        # Mesmo formato do totem: maior lado 640px, JPEG qualidade 85
        h, w = frame.shape[:2]
        scale = 640 / max(h, w)
        if scale < 1:
            frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        path = out / f"{saved:03d}.jpg"
        # cv2.imwrite falha em silêncio com acentos no caminho (Windows):
        # codifica em memória e grava pelo Python
        ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            sys.exit("Falha ao codificar o frame em JPEG.")
        path.write_bytes(jpeg.tobytes())
        saved += 1
        print(f"  {path.name}")
    cam.release()
    cv2.destroyAllWindows()
    print(f"{saved} frames em {out}")


def frame_paths(label: str) -> list[Path]:
    paths = sorted(Path(p) for p in glob.glob(str(FRAMES / label / "*.jpg")))
    if len(paths) <= ENROLL_FRAMES:
        sys.exit(f"Preciso de mais de {ENROLL_FRAMES} frames em {FRAMES / label} (use `capture`).")
    return paths


def query_frames(label: str) -> list[bytes]:
    """Frames de consulta: todos menos os usados no cadastro."""
    return [p.read_bytes() for p in frame_paths(label)[ENROLL_FRAMES:]]


def cmd_enroll(args) -> None:
    s = load_secrets()
    paths = frame_paths(args.label)[:ENROLL_FRAMES]

    async def run():
        async with client(s) as c:
            files = [("files", (p.name, p.read_bytes(), "image/jpeg")) for p in paths]
            data = {"tenant_id": s["tenant_id"], "person_id": str(args.person_id), **dek_fields(s)}
            r = await c.post("/embeddings/register", data=data, files=files)
            if r.status_code != 200:
                sys.exit(f"Falha no cadastro: HTTP {r.status_code} {r.text}")
            return r.json()

    res = asyncio.run(run())
    DATA.mkdir(exist_ok=True)
    people_file = DATA / "people.json"
    people = json.loads(people_file.read_text()) if people_file.exists() else []
    people = [p for p in people if p["person_id"] != res["person_id"]]
    people.append({
        "person_id": res["person_id"],
        "embedding_iv": res["embedding_iv"],
        "embedding_tag": res["embedding_tag"],
        "embedding_ct": res["embedding_ct"],
        "key_version": 1,
    })
    people_file.write_text(json.dumps(people))
    print(f"Pessoa {res['person_id']} cadastrada com {res['images_processed']} imagem(ns).")


def cmd_gen(args) -> None:
    """Vetores aleatórios de norma 1, cifrados com a DEK de bench.

    Custam o mesmo que rostos reais na comparação e na criptografia, e não
    geram falso positivo: dois vetores aleatórios em 512d ficam a distância
    ~1,41, acima do threshold de 1,10.
    """
    s = load_secrets()
    aes = AESGCM(bytes.fromhex(s["dek_hex"]))
    rng = np.random.default_rng(args.seed)
    DATA.mkdir(exist_ok=True)
    out = []
    t0 = time.time()
    for start in range(0, args.n, 5000):
        block = rng.standard_normal((min(5000, args.n - start), 512)).astype(np.float32)
        block /= np.linalg.norm(block, axis=1, keepdims=True)
        for i, vec in enumerate(block):
            iv = os.urandom(12)
            ct_tag = aes.encrypt(iv, vec.tobytes(), None)
            out.append({
                "person_id": f"d{start + i}",
                "embedding_iv": iv.hex(),
                "embedding_tag": ct_tag[-16:].hex(),
                "embedding_ct": ct_tag[:-16].hex(),
                "key_version": 1,
            })
    (DATA / "distractors.json").write_text(json.dumps(out))
    print(f"{len(out)} distratores em {time.time() - t0:.1f}s → {DATA / 'distractors.json'}")


_candidates_cache: dict[int, str] = {}


def candidates_json(n: int) -> str:
    """Seu rosto + (n-1) distratores, já serializado (como o backend envia)."""
    if n in _candidates_cache:
        return _candidates_cache[n]
    people_file, dist_file = DATA / "people.json", DATA / "distractors.json"
    if not people_file.exists():
        sys.exit("Rode `enroll` antes.")
    people = json.loads(people_file.read_text())
    need = max(0, n - len(people))
    distractors = json.loads(dist_file.read_text()) if need else []
    if len(distractors) < need:
        sys.exit(f"Só há {len(distractors)} distratores; rode `gen --n {need}` ou maior.")
    payload = json.dumps(people + distractors[:need])
    if len(payload) > MAX_FORM_PART:
        sys.exit(f"N={n} gera {len(payload) / 1024:.0f} KB de candidatos; o Starlette recusa campos "
                 f"de formulário acima de 1024 KB (HTTP 400), então a engine atual aceita no máximo "
                 f"~{MAX_FORM_PART // (len(payload) // n)} candidatos por request. Para N maior, "
                 "use `micro`, que mede a criptografia em processo, sem esse limite.")
    _candidates_cache[n] = payload
    return payload


# ── Medição ──────────────────────────────────────────────────────────────────

async def stats(c: httpx.AsyncClient) -> dict:
    r = await c.get("/bench/stats")
    r.raise_for_status()
    return r.json()


def cpu_delta(before: dict, after: dict, ok: int) -> dict:
    """CPU gasta entre duas leituras de /bench/stats."""
    wall = after["wall_s"] - before["wall_s"]
    proc = after["process_cpu_s"] - before["process_cpu_s"]
    out = {
        "wall_s": round(wall, 3),
        "engine_cpu_s": round(proc, 3),
        "engine_cpu_ms_per_req": round(proc * 1000 / ok, 2) if ok else None,
        "engine_cpu_util_pct": round(100 * proc / wall, 1) if wall else None,
        "rss_mb_after": after.get("rss_mb"),
        "mem_available_mb_after": after.get("mem_available_mb"),
    }
    if before.get("cgroup_cpu_usec") is not None and after.get("cgroup_cpu_usec") is not None:
        cg = (after["cgroup_cpu_usec"] - before["cgroup_cpu_usec"]) / 1e6
        out["container_cpu_ms_per_req"] = round(cg * 1000 / ok, 2) if ok else None
    hb, ha = before.get("host_cpu"), after.get("host_cpu")
    if hb and ha:
        keys = ["user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"]
        d = {k: ha.get(k, 0) - hb.get(k, 0) for k in keys}
        total = sum(d.values()) or 1
        out["host_busy_pct"] = round(100 * (total - d["idle"] - d["iowait"] - d["steal"]) / total, 1)
        out["host_steal_pct"] = round(100 * d["steal"] / total, 1)
    if out.get("engine_cpu_ms_per_req"):
        out["ceiling_req_per_s"] = round(1000 / out["engine_cpu_ms_per_req"], 1)
    return out


def pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    values = sorted(values)
    k = (len(values) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(values) - 1)
    return round(values[lo] + (values[hi] - values[lo]) * (k - lo), 1)


def summarize(samples: list[dict]) -> dict:
    ok = [x for x in samples if x.get("http") == 200]
    lat = [x["latency_ms"] for x in ok]
    by_status: dict[str, int] = {}
    for x in samples:
        key = x.get("status") or x.get("error") or f"http_{x.get('http')}"
        by_status[key] = by_status.get(key, 0) + 1
    stages: dict[str, list[float]] = {}
    for x in ok:
        for k, v in (x.get("timings") or {}).items():
            if k.endswith("_ms"):
                stages.setdefault(k, []).append(v)
    proc = [x["processing_ms"] for x in ok if x.get("processing_ms") is not None]
    return {
        "requests": len(samples),
        "ok": len(ok),
        "statuses": by_status,
        "latency_ms": {"p50": pct(lat, 50), "p95": pct(lat, 95), "p99": pct(lat, 99),
                       "max": round(max(lat), 1) if lat else None},
        "engine_processing_ms": {"p50": pct(proc, 50), "p95": pct(proc, 95)},
        # Latência fora do handler: rede, TLS, upload do multipart e fila
        "outside_engine_ms_p50": round(pct(lat, 50) - pct(proc, 50), 1) if lat and proc else None,
        "stages_ms_median": {k: round(statistics.median(v), 2) for k, v in sorted(stages.items())},
    }


async def recognize(c, s, frame: bytes, cands: str, args, t_origin: float) -> dict:
    data = {"tenant_id": s["tenant_id"], "candidates": cands, **dek_fields(s)}
    if args.liveness_threshold is not None:
        data["liveness_threshold"] = str(args.liveness_threshold)
    start = time.perf_counter()
    rec = {"start_s": round(start - t_origin, 3)}
    try:
        r = await c.post("/recognize", data=data,
                         files={"image": ("frame.jpg", frame, "image/jpeg")})
        rec["http"] = r.status_code
        if r.status_code == 200:
            body = r.json()
            rec["status"] = body.get("status")
            rec["processing_ms"] = body.get("processing_ms")
            rec["timings"] = body.get("timings_ms")
        else:
            rec["error"] = f"http_{r.status_code}"
    except httpx.TimeoutException:
        rec["error"] = "timeout"
    except httpx.HTTPError as exc:
        rec["error"] = type(exc).__name__
    end = time.perf_counter()
    rec["latency_ms"] = round((end - start) * 1000, 1)
    rec["end_s"] = round(end - t_origin, 3)
    return rec


def save_result(name: str, payload: dict) -> Path:
    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / f"{datetime.now():%Y%m%d-%H%M%S}_{name}.json"
    path.write_text(json.dumps(payload, indent=2))
    return path


def print_summary(title: str, summary: dict, cpu: dict) -> None:
    lat = summary["latency_ms"]
    print(f"\n── {title}")
    print(f"   ok {summary['ok']}/{summary['requests']}  status {summary['statuses']}")
    print(f"   latência p50 {lat['p50']}ms  p95 {lat['p95']}ms  p99 {lat['p99']}ms  "
          f"(engine p50 {summary['engine_processing_ms']['p50']}ms, "
          f"fora da engine {summary['outside_engine_ms_p50']}ms)")
    print(f"   CPU da engine {cpu.get('engine_cpu_ms_per_req')}ms/req → teto ≈ "
          f"{cpu.get('ceiling_req_per_s')} req/s  | host ocupado {cpu.get('host_busy_pct')}%  "
          f"steal {cpu.get('host_steal_pct')}%")
    if summary["stages_ms_median"]:
        print("   etapas (mediana ms): " + ", ".join(
            f"{k.removesuffix('_ms')}={v}" for k, v in summary["stages_ms_median"].items()
            if k != "total_ms"))


def warn_liveness(summary: dict) -> None:
    st = summary["statuses"]
    if st.get("liveness_failed", 0) > summary["requests"] * 0.2:
        print("   ⚠ muitos liveness_failed: a requisição sai antes do ArcFace/comparação e o "
              "custo fica subestimado. Recapture com mais luz ou use --liveness-threshold 0.5.")


def parse_ints(text: str) -> list[int]:
    return [int(x) for x in text.split(",") if x.strip()]


# ── Cenários ─────────────────────────────────────────────────────────────────

def cmd_check(args) -> None:
    s = load_secrets()

    async def run():
        async with client(s) as c:
            h = (await c.get("/health")).json()
            st = await stats(c)
            return h, st

    h, st = asyncio.run(run())
    print("health:", h["status"], h["models"])
    print("cpu:", st["cpu"])
    print("config:", st["config"])
    print(f"memória: {st['mem_available_mb']:.0f} de {st['mem_total_mb']:.0f} MB livres | "
          f"engine RSS {st['rss_mb']:.0f} MB | load {st['loadavg']}")


def cmd_micro(args) -> None:
    s = load_secrets()

    async def run():
        async with client(s, timeout=600) as c:
            r = await c.post("/bench/micro", json={"sizes": parse_ints(args.sizes), "reps": args.reps})
            r.raise_for_status()
            return r.json()

    res = asyncio.run(run())
    print(f"\nCPU: {res['cpu']}")
    print(f"{'N':>6} {'payload':>9} {'json':>8} {'hex':>8} {'aes':>8} {'cache':>8} "
          f"{'compare':>8} {'µs/emb':>7}")
    for row in res["results"]:
        st = row["stages_ms"]
        print(f"{row['n']:>6} {st['payload_bytes'] / 1e6:>7.2f}MB "
              f"{st['json_loads']['median']:>7.2f}ms {st['hex_decode']['median']:>6.2f}ms "
              f"{st['aes_gcm_decrypt']['median']:>6.2f}ms {st['cache_set']['median']:>6.2f}ms "
              f"{st['comparison']['median']:>6.2f}ms {st['aes_gcm_us_per_embedding']:>7}")
    print(f"\nsalvo em {save_result('micro', res)}")


def cmd_seq(args) -> None:
    s = load_secrets()
    frames = query_frames(args.label)
    runs = []

    async def run_one(n: int):
        cands = candidates_json(n)
        print(f"\nN={n}: payload de candidatos {len(cands) / 1e6:.2f} MB por request")
        async with client(s) as c:
            # Aquecimento: DEK e embeddings no cache (exceto no modo frio)
            if not args.cold:
                await recognize(c, s, frames[0], cands, args, time.perf_counter())
            before = await stats(c)
            t0 = time.perf_counter()
            samples = []
            for i in range(args.requests):
                if args.cold:
                    await c.post("/bench/reset")
                samples.append(await recognize(c, s, frames[i % len(frames)], cands, args, t0))
            after = await stats(c)
        summary = summarize(samples)
        cpu = cpu_delta(before, after, summary["ok"])
        print_summary(f"seq N={n} {'frio' if args.cold else 'quente'}", summary, cpu)
        warn_liveness(summary)
        runs.append({"n": n, "summary": summary, "cpu": cpu, "samples": samples})

    for n in parse_ints(args.n):
        asyncio.run(run_one(n))
    path = save_result("seq-cold" if args.cold else "seq",
                       {"scenario": "seq", "cold": args.cold, "runs": runs})
    print(f"\nsalvo em {path}")


def cmd_conc(args) -> None:
    s = load_secrets()
    frames = query_frames(args.label)
    cands = candidates_json(args.n)
    print(f"N={args.n}: payload {len(cands) / 1e6:.2f} MB por request")
    levels = []

    async def run_level(level: int):
        async with client(s, timeout=args.timeout, max_conn=level + 2) as c:
            await recognize(c, s, frames[0], cands, args, time.perf_counter())
            before = await stats(c)
            t0 = time.perf_counter()
            deadline = t0 + args.duration
            samples: list[dict] = []

            async def worker(w: int):
                i = w
                while time.perf_counter() < deadline:
                    samples.append(await recognize(c, s, frames[i % len(frames)], cands, args, t0))
                    i += level

            await asyncio.gather(*(worker(w) for w in range(level)))
            elapsed = time.perf_counter() - t0
            after = await stats(c)
        summary = summarize(samples)
        summary["throughput_req_per_s"] = round(summary["ok"] / elapsed, 2)
        cpu = cpu_delta(before, after, summary["ok"])
        print_summary(f"concorrência {level}: {summary['throughput_req_per_s']} req/s", summary, cpu)
        warn_liveness(summary)
        levels.append({"concurrency": level, "summary": summary, "cpu": cpu, "samples": samples})

    for level in parse_ints(args.levels):
        asyncio.run(run_level(level))
    print(f"\nsalvo em {save_result('conc', {'scenario': 'conc', 'n': args.n, 'levels': levels})}")


def cmd_burst(args) -> None:
    s = load_secrets()
    frames = query_frames(args.label)
    cands = candidates_json(args.n)
    print(f"Disparando {args.total} reconhecimentos de uma vez (N={args.n}, "
          f"payload {len(cands) / 1e6:.2f} MB cada, timeout {args.timeout}s)...")

    async def run():
        async with client(s, timeout=args.timeout, max_conn=args.total) as c:
            await recognize(c, s, frames[0], cands, args, time.perf_counter())
            before = await stats(c)
            t0 = time.perf_counter()
            samples = await asyncio.gather(*(
                recognize(c, s, frames[i % len(frames)], cands, args, t0)
                for i in range(args.total)
            ))
            elapsed = time.perf_counter() - t0
            after = await stats(c)
        return list(samples), elapsed, before, after

    samples, elapsed, before, after = asyncio.run(run())
    summary = summarize(samples)
    ok_ends = sorted(x["end_s"] for x in samples if x.get("http") == 200)
    summary["drain_s"] = round(ok_ends[-1], 1) if ok_ends else None
    summary["throughput_req_per_s"] = round(summary["ok"] / elapsed, 2)
    cpu = cpu_delta(before, after, summary["ok"])
    print_summary(f"rajada de {args.total}", summary, cpu)
    print(f"   último sucesso em {summary['drain_s']}s  |  vazão {summary['throughput_req_per_s']} req/s")
    warn_liveness(summary)
    path = save_result("burst", {"scenario": "burst", "n": args.n, "total": args.total,
                                 "timeout_s": args.timeout, "summary": summary, "cpu": cpu,
                                 "samples": samples})
    print(f"\nsalvo em {path}")


def cmd_report(args) -> None:
    from report import build_report

    path = build_report(RESULTS)
    print(f"Relatório: {path}")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    p = argparse.ArgumentParser(description="Benchmark de capacidade da face engine")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add(name, fn, **kw):
        sp = sub.add_parser(name, **kw)
        sp.set_defaults(fn=fn)
        return sp

    def recog_opts(sp):
        sp.add_argument("--label", default="me", help="pasta em frames/ (default: me)")
        sp.add_argument("--liveness-threshold", type=float, default=None,
                        help="sobrescreve o threshold de liveness (ex.: 0.5)")

    sp = add("init", cmd_init, help="gera chaves de bench e engine.env")
    sp.add_argument("--force", action="store_true")
    sp = add("set-url", cmd_set_url, help="define a URL da engine de bench")
    sp.add_argument("url")
    add("check", cmd_check, help="health + perfil da VPS")

    sp = add("capture", cmd_capture, help="captura frames da webcam")
    sp.add_argument("--label", default="me")
    sp.add_argument("--count", type=int, default=40)
    sp.add_argument("--interval", type=float, default=0.7)
    sp.add_argument("--camera", type=int, default=0)

    sp = add("enroll", cmd_enroll, help="cadastra um rosto via /embeddings/register")
    sp.add_argument("--label", default="me")
    sp.add_argument("--person-id", type=int, default=1)

    sp = add("gen", cmd_gen, help="gera distratores cifrados")
    sp.add_argument("--n", type=int, default=20000)
    sp.add_argument("--seed", type=int, default=7)

    sp = add("micro", cmd_micro, help="S1: microbench de criptografia dentro da VPS")
    sp.add_argument("--sizes", default="1,50,500,1000,5000,10000")
    sp.add_argument("--reps", type=int, default=5)

    sp = add("seq", cmd_seq, help="S2/S5: sequencial por N de candidatos")
    sp.add_argument("--n", default="1,50,100,240")
    sp.add_argument("--requests", type=int, default=30)
    sp.add_argument("--cold", action="store_true", help="esvazia o cache antes de cada request")
    recog_opts(sp)

    sp = add("conc", cmd_conc, help="S3: curva de concorrência")
    sp.add_argument("--n", type=int, default=50)
    sp.add_argument("--levels", default="1,2,4,8")
    sp.add_argument("--duration", type=float, default=30)
    sp.add_argument("--timeout", type=float, default=30)
    recog_opts(sp)

    sp = add("burst", cmd_burst, help="S4: rajada de reconhecimentos simultâneos")
    sp.add_argument("--n", type=int, default=50)
    sp.add_argument("--total", type=int, default=1000)
    sp.add_argument("--timeout", type=float, default=10, help="timeout do cliente (backend da visage usa 10s)")
    recog_opts(sp)

    add("report", cmd_report, help="gera results/report.html")

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
