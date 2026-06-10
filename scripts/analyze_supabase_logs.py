import csv
import re
import collections
from pathlib import Path
import datetime

def analyze_auth(path):
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    paths = collections.Counter()
    referers = collections.Counter()
    per_min = collections.Counter()
    tokens = 0
    users = 0
    for r in rows:
        msg = r.get("event_message") or ""
        p = r.get("path") or ""
        if p:
            paths[p] += 1
        m = re.search(r'"referer":"([^"]+)"', msg)
        if m:
            referers[m.group(1)] += 1
        if "/token" in p or "refresh_token" in msg:
            tokens += 1
        if p == "/user":
            users += 1
        ts = r.get("timestamp")
        if ts:
            try:
                t = int(ts) // 1_000_000
                dt = datetime.datetime.utcfromtimestamp(t)
                per_min[dt.strftime("%H:%M")] += 1
            except Exception:
                pass
    print("AUTH rows", len(rows))
    print("paths", paths.most_common(10))
    print("referers", referers.most_common(5))
    print("/user count", users, "token-ish", tokens)
    print("top minutes", per_min.most_common(8))

def analyze_edge(path):
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    tables = collections.Counter()
    auth = 0
    node = 0
    vercel = 0
    per_min = collections.Counter()
    booking_detail = 0
    staff = 0
    for r in rows:
        em = r.get("event_message") or ""
        if "/auth/v1/user" in em:
            auth += 1
        if "| node," in em:
            node += 1
        if "Vercel Edge" in em:
            vercel += 1
        if "/rest/v1/" in em:
            m = re.search(r"/rest/v1/([^?]+)", em)
            if m:
                tables[m.group(1)] += 1
        if "bookings?select=*" in em and "id=eq" in em:
            booking_detail += 1
        if "/rest/v1/staff" in em:
            staff += 1
        ts = r.get("timestamp")
        if ts:
            t = int(ts) // 1_000_000
            dt = datetime.datetime.utcfromtimestamp(t)
            per_min[dt.strftime("%H:%M")] += 1
    print("EDGE rows", len(rows))
    print("auth/v1/user", auth, "node", node, "vercel edge", vercel)
    print("staff lookups", staff)
    print("tables", tables.most_common(15))
    print("booking detail fetches", booking_detail)
    print("top minutes", per_min.most_common(8))

def analyze_pg(path):
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    apps = collections.Counter()
    for r in rows:
        em = r.get("event_message") or ""
        if "application_name=" in em:
            m = re.search(r"application_name=([^\s]+)", em)
            if m:
                apps[m.group(1)] += 1
    print("PG rows", len(rows))
    print("apps", apps.most_common(10))

base = Path(__file__).resolve().parents[1] / "Docs"
analyze_auth(base / "supabase-auth-logs-njualfobtudvlugqkqho.csv.csv")
print("---")
analyze_edge(base / "supabase-edge-logs-njualfobtudvlugqkqho.csv.csv")
print("---")
analyze_pg(base / "supabase-postgres-logs-njualfobtudvlugqkqho.csv.csv")
