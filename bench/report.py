"""
Gera results/report.html a partir dos JSON de results/.

Usa sempre o resultado MAIS RECENTE de cada cenário (micro, seq, seq-cold,
conc, burst). Gráficos via Chart.js (CDN); o resto é HTML estático.
"""

import html
import json
from pathlib import Path

STAGES = [
    ("dek_ms", "DEK"),
    ("candidates_parse_ms", "json.loads candidatos"),
    ("image_decode_ms", "decode JPEG"),
    ("detection_ms", "SCRFD + ArcFace"),
    ("liveness_ms", "liveness V1+V2"),
    ("hsv_ms", "HSV"),
    ("candidates_cache_lookup_ms", "cache lookup"),
    ("candidates_decrypt_ms", "decrypt (misses)"),
    ("comparison_ms", "comparação"),
]


def latest(results: Path, name: str) -> dict | None:
    files = sorted(results.glob(f"*_{name}.json"))
    return json.loads(files[-1].read_text()) if files else None


def table(headers: list[str], rows: list[list]) -> str:
    head = "".join(f"<th>{html.escape(str(h))}</th>" for h in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{html.escape('—' if c is None else str(c))}</td>" for c in r) + "</tr>"
        for r in rows
    )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def seq_section(data: dict, title: str, chart_id: str) -> str:
    runs = data["runs"]
    rows = []
    for r in runs:
        s, c = r["summary"], r["cpu"]
        rows.append([r["n"], f"{s['ok']}/{s['requests']}", s["latency_ms"]["p50"], s["latency_ms"]["p95"],
                     s["engine_processing_ms"]["p50"], s["outside_engine_ms_p50"],
                     c.get("engine_cpu_ms_per_req"), c.get("ceiling_req_per_s"), c.get("host_steal_pct")])
    datasets = [
        {"label": label, "data": [r["summary"]["stages_ms_median"].get(key, 0) for r in runs]}
        for key, label in STAGES
    ]
    chart = {"type": "bar", "data": {"labels": [f"N={r['n']}" for r in runs], "datasets": datasets},
             "options": {"plugins": {"title": {"display": True, "text": "Mediana por etapa (ms)"}},
                         "scales": {"x": {"stacked": True}, "y": {"stacked": True}}}}
    return (f"<h2>{title}</h2>"
            + table(["N candidatos", "ok", "p50 cliente", "p95 cliente", "p50 engine",
                     "fora da engine", "CPU ms/req", "teto req/s", "steal %"], rows)
            + f"<canvas id='{chart_id}'></canvas><script>charts.push(['{chart_id}', {json.dumps(chart)}]);</script>")


def build_report(results: Path) -> Path:
    parts = []

    micro = latest(results, "micro")
    if micro:
        rows = []
        for r in micro["results"]:
            st = r["stages_ms"]
            rows.append([r["n"], round(st["payload_bytes"] / 1e6, 2), st["json_loads"]["median"],
                         st["hex_decode"]["median"], st["aes_gcm_decrypt"]["median"],
                         st["cache_set"]["median"], st["cache_get_many"]["median"],
                         st["comparison"]["median"], st["aes_gcm_us_per_embedding"]])
        parts.append("<h2>S1 · Criptografia isolada (dentro da VPS)</h2>"
                     f"<p class='muted'>CPU: {html.escape(json.dumps(micro['cpu']))}</p>"
                     + table(["N", "payload MB", "json.loads ms", "hex ms", "AES-GCM ms", "cache.set ms",
                              "cache.get_many ms", "comparação ms", "µs/embedding"], rows))

    seq = latest(results, "seq")
    if seq:
        parts.append(seq_section(seq, "S2 · Sequencial, cache quente", "seq"))
    cold = latest(results, "seq-cold")
    if cold:
        parts.append(seq_section(cold, "S5 · Sequencial, cache frio", "seqcold"))

    conc = latest(results, "conc")
    if conc:
        lv = conc["levels"]
        rows = [[l["concurrency"], l["summary"]["throughput_req_per_s"], l["summary"]["latency_ms"]["p50"],
                 l["summary"]["latency_ms"]["p95"], l["summary"]["latency_ms"]["p99"],
                 l["cpu"].get("engine_cpu_util_pct"), l["cpu"].get("host_busy_pct"),
                 l["cpu"].get("host_steal_pct"), l["summary"]["statuses"]] for l in lv]
        chart = {"type": "line", "data": {"labels": [l["concurrency"] for l in lv], "datasets": [
            {"label": "req/s", "data": [l["summary"]["throughput_req_per_s"] for l in lv], "yAxisID": "y"},
            {"label": "p95 ms", "data": [l["summary"]["latency_ms"]["p95"] for l in lv], "yAxisID": "y1"}]},
            "options": {"scales": {"y": {"position": "left", "title": {"display": True, "text": "req/s"}},
                                   "y1": {"position": "right", "title": {"display": True, "text": "p95 ms"}}}}}
        parts.append(f"<h2>S3 · Concorrência (N={conc['n']})</h2>"
                     + table(["concorrência", "req/s", "p50", "p95", "p99", "CPU engine %", "host %",
                              "steal %", "status"], rows)
                     + f"<canvas id='conc'></canvas><script>charts.push(['conc', {json.dumps(chart)}]);</script>")

    burst = latest(results, "burst")
    if burst:
        s = burst["summary"]
        points = [{"x": x["start_s"], "y": x["latency_ms"]} for x in burst["samples"] if x.get("http") == 200]
        fails = [{"x": x["start_s"], "y": x["latency_ms"]} for x in burst["samples"] if x.get("http") != 200]
        chart = {"type": "scatter", "data": {"datasets": [
            {"label": "sucesso", "data": points}, {"label": "falha/timeout", "data": fails}]},
            "options": {"scales": {"x": {"title": {"display": True, "text": "disparo (s)"}},
                                   "y": {"title": {"display": True, "text": "latência ms"}}}}}
        parts.append(f"<h2>S4 · Rajada de {burst['total']} (N={burst['n']}, timeout {burst['timeout_s']}s)</h2>"
                     + table(["ok", "status", "p50", "p95", "último sucesso (s)", "vazão req/s", "CPU ms/req"],
                             [[f"{s['ok']}/{s['requests']}", s["statuses"], s["latency_ms"]["p50"],
                               s["latency_ms"]["p95"], s.get("drain_s"), s.get("throughput_req_per_s"),
                               burst["cpu"].get("engine_cpu_ms_per_req")]])
                     + f"<canvas id='burst'></canvas><script>charts.push(['burst', {json.dumps(chart)}]);</script>")

    page = f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Face engine bench</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
body{{font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:0 auto;padding:24px 16px;color:#1d1d1f;background:#fafafa}}
h1{{font-size:24px}} h2{{font-size:18px;margin-top:40px}} .muted{{color:#666;font-size:13px}}
table{{border-collapse:collapse;width:100%;font-size:13px;margin:12px 0;display:block;overflow-x:auto}}
th,td{{border-bottom:1px solid #ddd;padding:6px 8px;text-align:right;white-space:nowrap}} th{{background:#f0f0f0}}
canvas{{max-height:360px;margin-top:12px}}
</style></head><body><h1>Benchmark da face engine</h1>
<script>const charts=[];</script>
{''.join(parts) or '<p>Nenhum resultado em results/ ainda.</p>'}
<script>for (const [id, cfg] of charts) new Chart(document.getElementById(id), cfg);</script>
</body></html>"""
    out = results / "report.html"
    results.mkdir(exist_ok=True)
    out.write_text(page, encoding="utf-8")
    return out
