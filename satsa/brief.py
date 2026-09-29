"""Examination brief: a self-contained, printable HTML report for one entity (no external
assets, prints cleanly to PDF from any browser, fully offline)."""

from __future__ import annotations

import html
from datetime import datetime

CSCRF_QUESTIONS = [
    ("Whether monitoring through SOC is done round-the-clock?", ["EG11"]),
    ("Whether IOCs are processed by SOC?", ["EG4", "EG13"]),
    ("Whether threat intelligence is received and acted upon?", ["EG13"]),
    ("Whether qualified personnel are deployed in SOC (quality of investigation)?", ["EG1", "EG3", "EG4"]),
    ("Whether incidents are escalated as per the approved SOP?", ["EG2", "EG5"]),
    ("Whether incidents are reported to CERT-In within 6 hours?", ["EG12"]),
    ("Whether the SOC covers all critical assets and log sources?", ["NS1", "NS2", "NS3"]),
    ("Whether logs are retained for 180 days with synchronised clocks?", ["NS8", "NS9"]),
    ("Whether known attack techniques (red-team) are detected?", ["RT1"]),
]


def _e(x) -> str:
    return html.escape("" if x is None else str(x))


def _pct(x) -> str:
    return "-" if x is None else f"{100 * x:.1f}%"


def render(entity: dict, findings: list[dict], disp: dict, estimate: dict | None, quarterly: list[dict],
           run_meta: dict, ledger_head: dict | None, fdr: float = 0.10) -> str:
    sig = [f for f in findings if f.get("significant")]
    by_det = {f["detector_id"]: f for f in findings}
    flagged = entity["q_value"] <= fdr or entity.get("det_severity", 0) > 0
    rows = []
    for f in sig:
        d = disp.get(f["detector_id"], {})
        p = "documented fact" if f["deterministic"] else f"p = {f['p_value']:.2g}"
        rows.append(f"""<tr><td><b>{_e(f['detector_id'])}</b><br>{_e(f['name'])}</td><td>{_e(f['effect'])}<br>
          <span class=m>{_e(p)}</span></td><td>{_e(f['reason'])}<div class=m>Evidence: {_e(', '.join(map(str, (f.get('evidence') or [])[:8])))}</div>
          <div class=m>{_e('; '.join(f.get('regulations') or []))}</div></td>
          <td>{_e(d.get('status', 'open'))}<div class=m>{_e(d.get('reason') or '')}</div></td></tr>""")
    q_rows = []
    for question, dets in CSCRF_QUESTIONS:
        fs = [by_det[d] for d in dets if d in by_det]
        if not fs:
            ans, cls = "No evidence submitted", "na"
        elif any(f.get("significant") for f in fs):
            ans, cls = "Evidence contradicts a 'yes' (" + ", ".join(f["detector_id"] for f in fs if f.get("significant")) + ")", "no"
        elif all(f.get("p_value") is None and not f.get("deterministic") for f in fs):
            ans, cls = "Insufficient evidence", "na"
        else:
            ans, cls = "Evidence consistent with 'yes'", "yes"
        q_rows.append(f"<tr><td>{_e(question)}</td><td class={cls}>{_e(ans)}</td></tr>")
    est = ""
    if estimate and estimate.get("status") == "ok":
        pp, c = estimate["ppi"], estimate["classical"]
        est = (f"<p>Examiner-reviewed share of superficially handled cases (90% interval): <b>{_pct(pp['estimate'])}</b> "
               f"({_pct(pp['lo'])} - {_pct(pp['hi'])}) from {estimate['n_labeled_random']} random reviews plus model "
               f"predictions on {estimate['population']:,} cases (prediction-powered inference). Labels only: "
               f"{_pct(c['lo'])} - {_pct(c['hi'])}.</p>")
    elif estimate and estimate.get("n_labeled_random"):
        c = estimate["classical"]
        est = (f"<p>{estimate['n_labeled_random']} random reviews so far; share superficial {_pct(c['estimate'])} "
               f"({_pct(c['lo'])} - {_pct(c['hi'])}, 90%). More reviews needed for the prediction-powered estimate.</p>")
    else:
        est = "<p>No examiner reviews recorded yet.</p>"
    qe = " ".join(f"{_e(x['quarter'])}: e = {x['cum_e']:.3g}" for x in quarterly) or "-"
    lh = ledger_head or {}
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Examination brief {_e(entity['entity_id'])}</title>
<style>
 body{{font-family:Segoe UI,Arial,sans-serif;color:#111;margin:28px;font-size:13px;line-height:1.4}}
 h1{{font-size:20px;margin:0}} h2{{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #999}}
 table{{border-collapse:collapse;width:100%}} td,th{{border:1px solid #bbb;padding:5px 7px;vertical-align:top;text-align:left}}
 th{{background:#eee}} .m{{color:#555;font-size:11px;margin-top:3px}} .yes{{color:#0a6b3d}} .no{{color:#a30d0d;font-weight:600}} .na{{color:#777}}
 .flag{{display:inline-block;padding:3px 9px;border:1px solid;border-radius:4px;font-weight:600}}
 .foot{{margin-top:26px;color:#555;font-size:11px;border-top:1px solid #999;padding-top:8px}}
 @media print{{body{{margin:12mm}} .noprint{{display:none}}}}
</style></head><body>
<div class=noprint style="text-align:right"><button onclick="window.print()">Print / save as PDF</button></div>
<h1>SAT-SA examination brief: {_e(entity['entity_name'])} ({_e(entity['entity_id'])})</h1>
<div class=m>{_e(entity.get('sector_name'))} · SOC: {_e(entity.get('soc_provider'))} · size {_e(entity.get('size_band'))} ·
 generated {datetime.now().strftime('%d %b %Y %H:%M')} · run {_e(str(run_meta.get('run_hash', ''))[:16])}</div>
<p><span class=flag style="color:{'#a30d0d' if flagged else '#0a6b3d'}">{'FLAGGED FOR EXAMINER REVIEW' if flagged else 'NOT FLAGGED'}</span>
 &nbsp; attention {entity['attention']:.0f}/100 · q = {entity['q_value']:.2g} (FDR level {fdr:.0%}) · data trust {entity.get('trust_score', 0):.0f}/100</p>
<p>These are statistical flags and documented facts for an examiner to verify, not verdicts. Every finding lists the
records it rests on. The false-discovery rate of the flagged queue is controlled at {fdr:.0%}.</p>
<h2>Findings ({len(sig)})</h2>
<table><tr><th style="width:18%">Finding</th><th style="width:16%">Effect</th><th>Why, evidence, obligation</th><th style="width:14%">Examiner disposition</th></tr>
{''.join(rows) or '<tr><td colspan=4>No significant findings.</td></tr>'}</table>
<h2>SEBI CSCRF SOC-efficacy questions answered from evidence</h2>
<table><tr><th>Question</th><th>Answer from the submitted paper trail</th></tr>{''.join(q_rows)}</table>
<h2>Examiner review</h2>{est}
<h2>Evidence across quarters (anytime-valid)</h2><p>{qe}</p>
<div class=foot>Audit ledger head: {_e(lh.get('hash', '-'))} (entry {_e(lh.get('seq', '-'))}). Code {_e(run_meta.get('code_hash', ''))},
 input {_e(str(run_meta.get('input_hash', ''))[:16])}. Produced offline by SAT-SA {_e(run_meta.get('version', ''))}.</div>
</body></html>"""
