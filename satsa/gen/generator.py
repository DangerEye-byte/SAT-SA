"""Seeded synthetic SOC-submission panel.

Usage:  python -m satsa.gen.generator [--seed 7] [--out data/generated]

Produces parquet tables (entities, assets, alerts, cases, case_events,
escalations, submissions, redteam) plus a hidden answer key in _truth/.
"""

from __future__ import annotations

import argparse
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from satsa import taxonomy as tx
from satsa.gen import archetypes as ar
from satsa.gen import notes as nt

START = pd.Timestamp("2025-10-01")
DAYS = 365
END = START + pd.Timedelta(days=DAYS)
SLA_CRITICAL_MIN = 240           # time-to-resolve SLA for critical cases
RATE_SCALE = 0.5

SEVERITIES = np.array(["low", "medium", "high", "critical"])
SEV_RANK = {s: i for i, s in enumerate(SEVERITIES)}

CLASS_RATE = {  # alerts per asset per day (before RATE_SCALE)
    "endpoint": 4.0, "firewall": 3.0, "email_gw": 3.0, "web_server": 1.5, "vpn_gw": 1.5,
    "ad_dc": 1.2, "db_server": 0.6, "file_server": 0.6,
}
OT_CLASSES = {"scada_hmi", "rtu_gateway", "historian", "signalling"}
CLASS_CATS = {
    "ad_dc": {"brute_force": 3, "credential_dump": 1, "priv_escalation": 1, "lateral_rdp_smb": 1, "new_service": .5, "log_tamper": .3},
    "firewall": {"port_scan_external": 5, "network_scan": 1, "c2_beacon": 1, "exfil_large_upload": .5},
    "email_gw": {"phishing": 6, "malware_detected": 1},
    "web_server": {"exploit_public_app": 3, "port_scan_external": 2, "malicious_script": .5, "c2_beacon": .3},
    "db_server": {"brute_force": 1, "data_staging": .5, "exfil_large_upload": .4, "priv_escalation": .4},
    "vpn_gw": {"brute_force": 3, "port_scan_external": 1},
    "endpoint": {"malware_detected": 3, "malicious_script": 2, "phishing": 1, "sched_task": 1, "new_service": .5,
                 "policy_violation": 2, "c2_beacon": .5, "dns_tunnel": .3, "ransomware_behavior": .1,
                 "lateral_rdp_smb": .5, "credential_dump": .2, "data_staging": .2},
    "file_server": {"data_staging": 1, "ransomware_behavior": .2, "lateral_rdp_smb": .5, "policy_violation": 1},
    "_ot": {"ot_unauth_command": 1, "network_scan": 1, "lateral_rdp_smb": .5, "malware_detected": .5, "policy_violation": 1},
    "_crown": {"brute_force": 1, "priv_escalation": .5, "exploit_public_app": .6, "data_staging": .5,
               "exfil_large_upload": .3, "policy_violation": 1, "lateral_rdp_smb": .3, "log_tamper": .2},
}
SIZE_COMP = {
    "S": {"endpoint": 3, "firewall": 1, "email_gw": 1, "web_server": 1, "vpn_gw": 1, "ad_dc": 1, "db_server": 1, "file_server": 1, "_sector": 1},
    "M": {"endpoint": 8, "firewall": 2, "email_gw": 1, "web_server": 2, "vpn_gw": 1, "ad_dc": 2, "db_server": 3, "file_server": 2, "_sector": 2},
    "L": {"endpoint": 16, "firewall": 3, "email_gw": 2, "web_server": 4, "vpn_gw": 2, "ad_dc": 3, "db_server": 5, "file_server": 3, "_sector": 4},
}
SEV_PROBS = {
    "port_scan_external": [.7, .25, .05, 0], "network_scan": [.4, .4, .15, .05], "phishing": [.3, .45, .2, .05],
    "malware_detected": [.3, .4, .25, .05], "policy_violation": [.6, .3, .1, 0], "brute_force": [.4, .4, .15, .05],
    "_high": [.05, .2, .4, .35], "_default": [.2, .4, .3, .1],
}
HIGH_SEV_CATS = {"credential_dump", "ransomware_behavior", "ot_unauth_command", "c2_beacon", "lateral_rdp_smb",
                 "exfil_large_upload", "log_tamper", "priv_escalation", "dns_tunnel"}
TP_BY_SEV = {"low": .03, "medium": .08, "high": .20, "critical": .35}
REDTEAM_CATS = ["phishing", "malicious_script", "credential_dump", "lateral_rdp_smb", "c2_beacon", "dns_tunnel",
                "priv_escalation", "data_staging", "exfil_large_upload", "brute_force", "sched_task", "ot_unauth_command"]

# Two detection rules per category, shared across entities (vendor-style rule ids)
DETECTORS: dict[str, list[str]] = {}
_i = 1
for _cat in tx.CATEGORIES:
    DETECTORS[_cat] = [f"DET-{_i:03d}", f"DET-{_i + 1:03d}"]
    _i += 2


def _class_cats(cls: str) -> dict:
    if cls in CLASS_CATS:
        return CLASS_CATS[cls]
    return CLASS_CATS["_ot"] if cls in OT_CLASSES else CLASS_CATS["_crown"]


def _class_rate(cls: str) -> float:
    if cls in CLASS_RATE:
        return CLASS_RATE[cls]
    return 0.8 if cls in OT_CLASSES else 0.8


def _sev_probs(cat: str):
    if cat in SEV_PROBS:
        return SEV_PROBS[cat]
    return SEV_PROBS["_high"] if cat in HIGH_SEV_CATS else SEV_PROBS["_default"]


def _month_idx(ts: pd.Series) -> np.ndarray:
    return ((ts.dt.year - START.year) * 12 + ts.dt.month - START.month).to_numpy()


def _entity_sources(sector: str, p: dict, rng) -> list[str]:
    src = [s for s in tx.LOG_SOURCES if s != "ot_ids"]
    if sector in ("PWR", "TRN"):
        src.append("ot_ids")
    src = [s for s in src if s not in p["drop_sources"]]
    if not p["drop_sources"] and rng.random() < 0.3:
        src = [s for s in src if s != "waf"]
    return sorted(src)


def _make_assets(eid: str, sector: str, size: str, rng) -> pd.DataFrame:
    comp = SIZE_COMP[size]
    sector_classes = [c for c, (_, _, secs) in tx.ASSET_CLASSES.items() if secs and sector in secs]
    rows, n = [], 0
    for cls, k in comp.items():
        classes = sector_classes if cls == "_sector" else [cls]
        for c in classes:
            for _ in range(k):
                n += 1
                name, crit, _ = tx.ASSET_CLASSES[c]
                rows.append((f"{eid}-A{n:04d}", eid, c, f"{name} #{n}", crit))
    return pd.DataFrame(rows, columns=["asset_id", "entity_id", "asset_class", "asset_name", "criticality"])


def _gen_alerts(eid, assets, sources, p, rng):
    srcset = set(sources)
    frames = []
    n_assets = len(assets)
    silent_idx = set()
    if p["silent_assets"]:
        if p["silent_class"]:
            silent_idx = set(np.where(assets.asset_class == p["silent_class"])[0])
        else:
            order = assets.sort_values(["criticality", "asset_class"], ascending=[False, True])
            cand = [i for i in order.index if assets.loc[i, "asset_class"] in OT_CLASSES | {"core_banking", "hlr_hss", "citizen_portal", "his", "classified_lan"}]
            cand = cand or list(order.index)
            silent_idx = set(cand[: p["silent_assets"]])
    for i in range(n_assets):
        a = assets.iloc[i]
        cats = {c: w for c, w in _class_cats(a.asset_class).items() if tx.CATEGORY_SOURCES[c] & srcset}
        if not cats:
            continue
        counts = rng.poisson(_class_rate(a.asset_class) * RATE_SCALE, DAYS)
        if i in silent_idx:
            counts[p["silent_from_day"]:] = 0
        total = int(counts.sum())
        if total == 0:
            continue
        day = np.repeat(np.arange(DAYS), counts)
        biz = rng.random(total) < 0.55
        minute = np.where(biz, rng.integers(8 * 60, 19 * 60, total), rng.integers(0, 24 * 60, total))
        names = list(cats)
        w = np.array([cats[c] for c in names], float)
        cat = rng.choice(names, size=total, p=w / w.sum())
        frames.append(pd.DataFrame({"asset_id": a.asset_id, "asset_class": a.asset_class, "criticality": a.criticality,
                                    "day": day, "minute": minute, "category": cat}))
    al = pd.concat(frames, ignore_index=True)
    al["ts"] = START + pd.to_timedelta(al.day, "D") + pd.to_timedelta(al.minute, "m") + pd.to_timedelta(rng.integers(0, 60, len(al)), "s")
    sev = np.empty(len(al), dtype=object)
    for c, idx in al.groupby("category").indices.items():
        sev[idx] = rng.choice(SEVERITIES, size=len(idx), p=_sev_probs(c))
    bump = (al.criticality.to_numpy() == 4) & (rng.random(len(al)) < 0.3)
    ranks = np.array([SEV_RANK[s] for s in sev]) + bump
    al["severity"] = SEVERITIES[np.minimum(ranks, 3)]
    prim = rng.random(len(al)) < 0.8
    al["detector_id"] = [DETECTORS[c][0 if pr else 1] for c, pr in zip(al.category, prim)]
    tp = rng.random(len(al)) < al.severity.map(TP_BY_SEV).to_numpy()
    al["disposition"] = np.where(tp, "TP", np.where(rng.random(len(al)) < 0.45, "FP", "BP"))
    al["redteam"] = False
    al["recurrence_of"] = None
    if p["ratchet_category"]:
        det = DETECTORS[p["ratchet_category"]][0]
        mi = _month_idx(al.ts)
        kill = (al.detector_id.to_numpy() == det) & (mi >= p["ratchet_from_month"]) & (rng.random(len(al)) > 0.03)
        al = al[~kill]
    return al.drop(columns=["day", "minute"]).reset_index(drop=True)


def _redteam(eid, assets, sources, p, rng):
    srcset = set(sources)
    t0 = START + pd.Timedelta(days=200, hours=10)
    rows, alerts = [], []
    for k, cat in enumerate(REDTEAM_CATS):
        cls_pref = {"ot_unauth_command": list(OT_CLASSES), "phishing": ["email_gw", "endpoint"],
                    "brute_force": ["vpn_gw", "ad_dc"], "credential_dump": ["ad_dc", "endpoint"]}.get(cat, ["endpoint", "file_server", "db_server"])
        cand = assets[assets.asset_class.isin(cls_pref)]
        if cand.empty:
            continue
        a = cand.iloc[rng.integers(len(cand))]
        start = t0 + pd.Timedelta(hours=k * 3)
        tactic, tid, tname = tx.CATEGORIES[cat]
        rows.append({"entity_id": eid, "exercise_id": f"RT-{eid}-2026Q2", "category": cat, "tactic": tactic,
                     "technique_id": tid, "technique": tname, "target_asset": a.asset_id, "start_ts": start,
                     "end_ts": start + pd.Timedelta(minutes=45)})
        supportable = bool(tx.CATEGORY_SOURCES[cat] & srcset)
        ratcheted = p["ratchet_category"] == cat
        silenced = p["silent_class"] is not None and a.asset_class == p["silent_class"]
        if supportable and not ratcheted and not silenced and rng.random() < 0.95:
            alerts.append({"asset_id": a.asset_id, "asset_class": a.asset_class, "criticality": a.criticality,
                           "category": cat, "ts": start + pd.Timedelta(minutes=int(rng.integers(2, 30))),
                           "severity": "high", "detector_id": DETECTORS[cat][0], "disposition": "TP",
                           "redteam": True, "recurrence_of": None})
    return pd.DataFrame(rows), pd.DataFrame(alerts)


def _gen_cases(eid, al, p, analysts, rng, start_no=0):
    """Turn alerts into cases + events + escalations. Returns frames and truth."""
    sev = al.severity.to_numpy()
    take = (np.isin(sev, ["high", "critical"]) | ((sev == "medium") & (rng.random(len(al)) < 0.35))
            | al.redteam.to_numpy() | al.recurrence_of.notna().to_numpy())
    c = al[take].reset_index(drop=True)
    n = len(c)
    csev = c.severity.to_numpy()
    tp = c.disposition.to_numpy() == "TP"
    crit = csev == "critical"
    open_ts = c.ts + pd.to_timedelta(rng.uniform(1, 8, n), "m")
    hour = open_ts.dt.hour.to_numpy()
    month = _month_idx(open_ts)

    soar = np.isin(csev, ["medium", "high"]) & ~tp & (rng.random(n) < p["soar_rate"]) & ~c.redteam.to_numpy()
    sup_p = np.full(n, p["sup_base"]) + crit * p["sup_crit_extra"]
    if p["decay_start_month"] is not None:
        sup_p += np.clip(month - p["decay_start_month"] + 1, 0, None) * 0.07
    night = hour < 6
    if p["night_gap"]:
        sup_p += night * 0.35
    sup = ~soar & (rng.random(n) < np.clip(sup_p, 0, 0.95))

    med_ack = np.select([crit, csev == "high"], [5.0, 9.0], 15.0)
    ack_delay = rng.lognormal(np.log(med_ack), 0.7)
    ack_delay = np.where(soar, 0.2, ack_delay)
    if p["night_gap"]:
        morning = open_ts.dt.normalize() + pd.Timedelta(hours=8, minutes=30)
        wait = (morning - open_ts).dt.total_seconds().to_numpy() / 60 + rng.uniform(0, 90, n)
        ack_delay = np.where(night & ~soar, wait, ack_delay)
    med_work = np.select([crit, csev == "high"], [150.0, 200.0], 280.0)
    work = rng.lognormal(np.log(med_work), 0.75)
    work = np.where(sup, rng.lognormal(np.log(4.0), 0.5), work)
    work = np.where(soar, rng.uniform(1, 3, n), work)
    if p["sla_gamer"]:
        ttc = ack_delay + work
        pull = crit & ~sup & ~soar & (ttc > SLA_CRITICAL_MIN) & (ttc < 2.2 * SLA_CRITICAL_MIN) & (rng.random(n) < p["sla_gamer"])
        target = rng.uniform(SLA_CRITICAL_MIN - 26, SLA_CRITICAL_MIN - 0.5, n)
        work = np.where(pull & (target > ack_delay + 1), target - ack_delay, work)
    ack_ts = open_ts + pd.to_timedelta(ack_delay, "m")
    close_ts = ack_ts + pd.to_timedelta(work, "m")
    still_open = ((END - open_ts).dt.days < 10) & (rng.random(n) < 0.3) | (rng.random(n) < 0.01)
    close_ts = close_ts.where(~still_open, pd.NaT)

    required = crit | (tp & (csev == "high"))
    esc = np.where(sup, rng.random(n) < 0.08, rng.random(n) < p["esc_rate"])
    escalated = (required & esc) | (~required & ~soar & (rng.random(n) < 0.04))
    rem = np.where(tp & ~sup, rng.random(n) < p["remediation_rate"], tp & (rng.random(n) < 0.1))
    ioc = np.where(soar, True, np.where(sup, rng.random(n) < 0.1, rng.random(n) < p["ioc_rate"]))
    skew = rng.random(n) < p["clock_skew"]
    ack_rec = ack_ts - pd.to_timedelta(np.where(skew, rng.uniform(20, 60, n), 0), "m")

    notes, events, escs = [], [], []
    inj = set(rng.choice(np.where(sup)[0], size=min(p["injection_notes"], int(sup.sum())), replace=False)) if p["injection_notes"] else set()
    case_ids = [f"{eid}-CS{start_no + i + 1:06d}" for i in range(n)]
    analyst = rng.choice(analysts, size=n)
    for i in range(n):
        cid = case_ids[i]
        if soar[i]:
            pb = f"PB-{rng.integers(1, 12):02d}"
            notes.append(nt.soar_note(rng, pb))
            analyst[i] = "SOAR"
        elif i in inj:
            notes.append(nt.injection_note(rng))
        elif sup[i]:
            r = rng.random()
            if r < p["template_share"]:
                notes.append(nt.template_note(rng))
            elif r < p["template_share"] + p["boilerplate_share"]:
                notes.append(nt.boilerplate_note(rng))
            else:
                notes.append(nt.superficial_note(rng))
        else:
            r = rng.random()
            if r < p["template_share"]:
                notes.append(nt.template_note(rng))
            elif r < p["template_share"] + p["boilerplate_share"]:
                notes.append(nt.boilerplate_note(rng))
            else:
                notes.append(nt.rich_note(rng, c.category.iat[i], c.asset_id.iat[i], c.disposition.iat[i]))
        o, a_true, a_rec, cl = open_ts.iat[i], ack_ts.iat[i], ack_rec.iat[i], close_ts.iat[i]
        end = cl if pd.notna(cl) else a_true + pd.Timedelta(minutes=float(work[i]))
        span = (end - a_true).total_seconds()
        ev = [(cid, o, "open", "system"), (cid, a_rec, "ack", analyst[i])]
        if soar[i]:
            ev += [(cid, a_true + pd.Timedelta(seconds=span * .2), "enrich", "SOAR"),
                   (cid, a_true + pd.Timedelta(seconds=span * .5), "playbook", "SOAR")]
        else:
            ev.append((cid, a_rec + pd.Timedelta(seconds=max(30, span * .05)), "triage", analyst[i]))
            if not sup[i]:
                k = int(rng.integers(1, 4))
                for j in range(k):
                    ev.append((cid, a_true + pd.Timedelta(seconds=span * (0.15 + 0.5 * (j + 1) / (k + 1))), "investigate", analyst[i]))
                if tp[i]:
                    ev.append((cid, a_true + pd.Timedelta(seconds=span * .7), "contain", analyst[i]))
            if escalated[i]:
                t = a_true + pd.Timedelta(seconds=span * .6)
                ev.append((cid, t, "escalate", analyst[i]))
                lvl = "CISO" if (crit[i] and tp[i]) else "L2"
                escs.append((cid, eid, t, lvl, t + pd.Timedelta(minutes=float(rng.uniform(5, 60)))))
            if rem[i]:
                ev.append((cid, a_true + pd.Timedelta(seconds=span * .85), "remediate", analyst[i]))
        if pd.notna(cl):
            ev.append((cid, cl, "close", analyst[i]))
        events.extend(ev)
        # Regulatory reporting (CERT-In 6 h; NCIIPC for critical)
        if tp[i] and csev[i] in ("high", "critical") and not c.redteam.iat[i]:
            miss = p["report_missing"] if not sup[i] else 0.5
            if rng.random() > miss:
                lat_h = rng.lognormal(np.log(p["report_median_h"]), 0.6)
                t = c.ts.iat[i] + pd.Timedelta(hours=float(lat_h))
                escs.append((cid, eid, t, "CERT-In", t + pd.Timedelta(minutes=float(rng.uniform(30, 240)))))
                if crit[i]:
                    escs.append((cid, eid, t + pd.Timedelta(minutes=10), "NCIIPC", pd.NaT))

    cases = pd.DataFrame({
        "case_id": case_ids, "entity_id": eid, "alert_id": c.alert_id, "asset_id": c.asset_id,
        "category": c.category, "tactic": c.category.map(tx.TACTIC_OF), "detector_id": c.detector_id,
        "severity": csev, "disposition": c.disposition, "alert_ts": c.ts, "opened_ts": open_ts,
        "ack_ts": ack_rec, "closed_ts": close_ts, "analyst_id": analyst, "escalated": escalated,
        "remediation_required": tp, "remediated": rem, "ioc_enriched": ioc, "auto_closed": soar,
        "notes": notes, "redteam": c.redteam.to_numpy(),
    })
    ev = pd.DataFrame(events, columns=["case_id", "ts", "activity", "actor"])
    es = pd.DataFrame(escs, columns=["case_id", "entity_id", "ts", "to_level", "acknowledged_ts"])
    truth = pd.DataFrame({"case_id": case_ids, "superficial": sup})
    return cases, ev, es, truth


def gen_entity(eid, name, arch, size, provider, rng):
    p = ar.params_for(arch, provider)
    size = p["size"] or size
    sector = eid[:3]
    sources = _entity_sources(sector, p, rng)
    assets = _make_assets(eid, sector, size, rng)
    assets["log_sources"] = ",".join(sources)
    assets["declared_monitored"] = True
    al = _gen_alerts(eid, assets, sources, p, rng)
    rt_rows, rt_alerts = (pd.DataFrame(), pd.DataFrame())
    if eid in ar.REDTEAM_ENTITIES:
        rt_rows, rt_alerts = _redteam(eid, assets, sources, p, rng)
        if not rt_alerts.empty:
            al = pd.concat([al, rt_alerts], ignore_index=True)
    al = al.sort_values("ts").reset_index(drop=True)
    al["alert_id"] = [f"{eid}-AL{i + 1:07d}" for i in range(len(al))]
    analysts = [f"{eid}-AN{i + 1:02d}" for i in range({"S": 5, "M": 10, "L": 18}[size])]
    cases, ev, es, truth = _gen_cases(eid, al, p, analysts, rng)

    # Recurrence: unremediated true positives come back on the same asset/rule
    unrem = cases[cases.remediation_required & ~cases.remediated & cases.closed_ts.notna()]
    rec_rows = []
    for _, r in unrem.iterrows():
        for _ in range(rng.poisson(1.2)):
            t = r.closed_ts + pd.Timedelta(days=float(rng.uniform(3, 30)))
            if t < END:
                rec_rows.append({"asset_id": r.asset_id, "category": r.category, "ts": t, "severity": r.severity,
                                 "detector_id": r.detector_id, "disposition": "TP", "redteam": False,
                                 "recurrence_of": r.alert_id})
    if rec_rows:
        rec = pd.DataFrame(rec_rows).merge(assets[["asset_id", "asset_class", "criticality"]], on="asset_id")
        rec["alert_id"] = [f"{eid}-AR{i + 1:07d}" for i in range(len(rec))]
        c2, ev2, es2, t2 = _gen_cases(eid, rec, p, analysts, rng, start_no=len(cases))
        al = pd.concat([al, rec], ignore_index=True)
        cases, ev, es, truth = (pd.concat([cases, c2], ignore_index=True), pd.concat([ev, ev2], ignore_index=True),
                                pd.concat([es, es2], ignore_index=True), pd.concat([truth, t2], ignore_index=True))

    # Retention gap: history truncated and a 10-day hole
    if p["retention_days"]:
        cut = END - pd.Timedelta(days=p["retention_days"])
        hole = (START + pd.Timedelta(days=300), START + pd.Timedelta(days=310))
        keep_al = (al.ts >= cut) & ~((al.ts >= hole[0]) & (al.ts < hole[1]))
        al = al[keep_al]
        keep_cs = cases.alert_id.isin(al.alert_id)
        cases = cases[keep_cs]
    # Attrition: from month m, the worst cases quietly stop being submitted
    if p["attrition_from_month"] is not None:
        mi = _month_idx(cases.opened_ts)
        sup_map = truth.set_index("case_id").superficial
        is_sup = cases.case_id.map(sup_map).to_numpy()
        drop = (mi >= p["attrition_from_month"]) & (rng.random(len(cases)) < np.where(is_sup, 0.85, 0.35))
        cases = cases[~drop]
    ev = ev[ev.case_id.isin(cases.case_id)]
    es = es[es.case_id.isin(cases.case_id)]
    truth = truth[truth.case_id.isin(cases.case_id)]

    subs = []
    for m in range(12):
        ms = START + pd.DateOffset(months=m)
        me = ms + pd.DateOffset(months=1)
        due = me + pd.Timedelta(days=7)
        late = p["attrition_from_month"] is not None and m >= p["attrition_from_month"]
        received = due + pd.Timedelta(days=float(rng.uniform(8, 20))) if late else due - pd.Timedelta(days=float(rng.uniform(0, 4)))
        subs.append({"submission_id": f"{eid}-SUB{m + 1:02d}", "entity_id": eid, "period": ms.strftime("%Y-%m"),
                     "due_ts": due, "received_ts": received,
                     "n_alerts": int(((al.ts >= ms) & (al.ts < me)).sum()),
                     "n_cases": int(((cases.opened_ts >= ms) & (cases.opened_ts < me)).sum())})

    ent = {"entity_id": eid, "entity_name": name, "sector": sector, "sector_name": tx.SECTORS[sector],
           "size_band": size, "soc_provider": provider, "claims_24x7": size != "S",
           "declared_log_sources": ",".join(sources), "n_assets": len(assets), "n_analysts": len(analysts),
           "sla_critical_min": SLA_CRITICAL_MIN}
    al_out = al.drop(columns=["asset_class", "criticality"]).assign(entity_id=eid)
    al_out["tactic"] = al_out.category.map(tx.TACTIC_OF)
    al_out["technique_id"] = al_out.category.map(lambda c: tx.CATEGORIES[c][1])
    return dict(entities=pd.DataFrame([ent]), assets=assets, alerts=al_out, cases=cases, case_events=ev,
                escalations=es, submissions=pd.DataFrame(subs), redteam=rt_rows, truth=truth)


def generate(out_dir: str | Path = "data/generated", seed: int = 7, roster=None, rate_scale: float = 0.5) -> dict:
    """Write one panel. `roster` defaults to the demo roster; `rate_scale` scales alert
    volume (the validation suite uses smaller panels for its many null runs)."""
    global RATE_SCALE
    RATE_SCALE = rate_scale
    warnings.filterwarnings("ignore", category=DeprecationWarning)
    out = Path(out_dir)
    (out / "_truth").mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    roster = roster or ar.ROSTER
    parts: dict[str, list] = {}
    for eid, name, arch, size, prov in roster:
        res = gen_entity(eid, name, arch, size, prov, rng)
        for k, v in res.items():
            parts.setdefault(k, []).append(v)
    tables = {k: pd.concat([x for x in v if len(x)], ignore_index=True) for k, v in parts.items()}
    esc = tables["escalations"]
    esc.insert(0, "esc_id", [f"ES{i + 1:07d}" for i in range(len(esc))])
    for k, df in tables.items():
        if k == "truth":
            df.to_parquet(out / "_truth" / "case_truth.parquet", index=False)
        else:
            df.to_parquet(out / f"{k}.parquet", index=False)
    gt = {eid: {"archetype": arch, "provider": prov, "expected_detectors": ar.EXPECTED[arch]}
          for eid, _, arch, _, prov in roster}
    meta = {"seed": seed, "rate_scale": rate_scale, "start": str(START.date()), "end": str(END.date()),
            "weak_provider": ar.WEAK_PROVIDER, "entities": gt}
    (out / "_truth" / "ground_truth.json").write_text(json.dumps(meta, indent=2))
    return tables


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default="data/generated")
    a = ap.parse_args()
    import time
    t = time.time()
    tables = generate(a.out, a.seed)
    print({k: len(v) for k, v in tables.items()}, f"{time.time() - t:.1f}s")


if __name__ == "__main__":
    main()
