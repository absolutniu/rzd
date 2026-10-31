"""Обновление слепка реестра клеймения (sources/rsfgt_registry.json) — раз в месяц.

rsfgt.ru не отвечает на запросы скриптов, поэтому реестр выгружается из браузера:
1. python rsfgt_receiver.py — ждёт выгрузку на http://127.0.0.1:8977 (Ctrl+C — выход);
2. открыть https://rsfgt.ru/Stamps/IssuedCerts, в консоли браузера (F12) выполнить BROWSER_JS ниже;
   Chrome спросит доступ сайта к локальной сети — разрешить;
3. приёмник сохранит sources/rsfgt_registry.json (только нужные депо), затем build_db.py и export_catalog.py.
"""
import json
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = Path(__file__).parent
OUT = BASE / "sources" / "rsfgt_registry.json"
HOLDING_INN = {"7705845722", "7708737490", "7708737500"}  # НВРК, ВРК-1, ОМК Стальной путь

BROWSER_JS = r"""
const t = $('#dataTable').DataTable(), all = [];
t.page.len(500); await new Promise(r => { t.one('draw', r); t.draw(); });
for (let p = 0; p < t.page.info().pages; p++) {
  if (p) await new Promise(r => { t.one('draw', r); t.page(p).draw('page'); });
  all.push(...t.rows().data().toArray());
}
const cl = s => String(s || '').replace(/\r/g, '').trim();
const d = s => { const m = String(s || '').match(/(\d\d)\.(\d\d)\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
const rows = all.map(r => ({stamp: r.stampNum, status: r.stampStatus, cert: r.title, id: r.id, org: cl(r.contragent),
  inn: r.contragentINN, orgAddr: cl(r.contragentCity), place: cl(r.place), reg: d(r.registration), valid: d(r.validity), usage: cl(r.usage)}));
await (await fetch('http://127.0.0.1:8977/', {method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({fetched: new Date().toISOString(), source: location.href, rows})})).text();
"""


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "https://rsfgt.ru")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_POST(self):
        reg = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        total = len(reg["rows"])
        conn = sqlite3.connect(BASE / "rzd.db")
        stamps = {s.lstrip("0") for (s,) in conn.execute("SELECT stamp_code FROM depots") if s}
        conn.close()
        from rsfgt import STAMP_OVERRIDE
        stamps |= {s for s, _ in STAMP_OVERRIDE.values()}
        reg["rows"] = [r for r in reg["rows"] if r["stamp"].lstrip("0") in stamps or r["inn"] in HOLDING_INN]
        reg["note"] = "Фрагмент реестра: клейма депо из справочника + все записи ИНН НВРК, ВРК-1, ОМК Стальной путь"
        OUT.write_text(json.dumps(reg, ensure_ascii=False, indent=0), encoding="utf-8")
        msg = f"сохранено {len(reg['rows'])} из {total} записей -> {OUT}"
        print(msg, flush=True)
        self.send_response(200); self._cors(); self.end_headers()
        self.wfile.write(msg.encode())


if __name__ == "__main__":
    print("Жду выгрузку реестра на http://127.0.0.1:8977 ... Код для консоли браузера:\n" + BROWSER_JS, flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8977), Handler).serve_forever()
