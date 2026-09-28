"""Entity roster and planted weakness archetypes for the seeded synthetic panel.

Every archetype lists the detectors that *should* fire on it; the answer key is
written to data/generated/_truth/ground_truth.json and is never exposed by the API
except through the validation report and the explicit "simulated examiner" demo."""

from __future__ import annotations

BASE = dict(
    sup_base=0.03,        # P(case is superficially handled)
    sup_crit_extra=0.0,   # extra P(superficial) for critical cases
    esc_rate=0.93,        # P(required escalation is performed | not superficial)
    report_median_h=2.2,  # median hours from first alert to CERT-In report
    report_missing=0.04,
    template_share=0.0,   # share of notes drawn from a small template set
    boilerplate_share=0.0,
    ioc_rate=0.72,        # share of cases carrying threat-intel / IOC enrichment
    remediation_rate=0.86,
    soar_rate=0.06,       # share of medium/high non-TP cases closed by a SOAR playbook
    night_gap=False,
    sla_gamer=0.0,        # share of over-SLA critical closures pulled under the SLA
    clock_skew=0.0,       # share of cases whose ack clock runs behind
    decay_start_month=None,
    silent_assets=0,
    silent_class=None,
    silent_from_day=0,
    drop_sources=(),
    ratchet_category=None,
    ratchet_from_month=None,
    retention_days=None,
    attrition_from_month=None,
    injection_notes=0,
    size=None,
)

ARCHETYPES: dict[str, dict] = {
    "healthy": {},
    "utility_p": dict(sup_base=0.10, sup_crit_extra=0.50, esc_rate=0.30, template_share=0.35,
                      remediation_rate=0.30, drop_sources=("edr", "netflow", "ot_ids"),
                      silent_class="rtu_gateway", silent_assets=99, silent_from_day=273,
                      injection_notes=3, size="M"),
    "quick_closer": dict(sup_base=0.28, sup_crit_extra=0.12, ioc_rate=0.25, remediation_rate=0.45,
                         injection_notes=4),
    "template_writer": dict(sup_base=0.18, template_share=0.60, injection_notes=3),
    "unescalated": dict(esc_rate=0.35, sup_base=0.06),
    "sla_gamer": dict(sla_gamer=0.75, sup_base=0.06, size="L"),
    "silent_asset": dict(silent_assets=3, silent_class=None, silent_from_day=0),
    "blind": dict(drop_sources=("edr", "dns")),
    "ratchet": dict(ratchet_category="brute_force", ratchet_from_month=5),
    "slow_decay": dict(decay_start_month=6),
    "attrition": dict(attrition_from_month=7),
    "night_gap": dict(night_gap=True),
    "late_reporter": dict(report_median_h=9.0, report_missing=0.12),
    "clock_skew": dict(clock_skew=0.30),
    "retention_gap": dict(retention_days=120),
    "hard_neg_soar": dict(soar_rate=0.62, size="L"),
    "hard_neg_small": dict(size="S"),
}

# Detectors that should fire for each archetype (validation answer key)
EXPECTED = {
    "healthy": [],
    "utility_p": ["NS1", "NS3", "EG1", "EG2", "EG3", "EG7"],
    "quick_closer": ["EG1", "EG4", "EG13"],
    "template_writer": ["EG3"],
    "unescalated": ["EG2"],
    "sla_gamer": ["EG6"],
    "silent_asset": ["NS1"],
    "blind": ["NS3"],
    "ratchet": ["NS5"],
    "slow_decay": ["EG1", "EG4"],
    "attrition": ["NS7"],
    "night_gap": ["EG11"],
    "late_reporter": ["EG12"],
    "clock_skew": ["NS9"],
    "retention_gap": ["NS8"],
    "hard_neg_soar": [],
    "hard_neg_small": [],
}

# (entity_id, display name, archetype, size, provider)
ROSTER = [
    ("PWR-01", "Utility P", "utility_p", "M", "INHOUSE"),
    ("PWR-02", "Power Utility B", "healthy", "L", "INHOUSE"),
    ("PWR-03", "Power Utility C", "ratchet", "M", "MSSP-1"),
    ("PWR-04", "Power Utility D", "healthy", "M", "INHOUSE"),
    ("PWR-05", "Power Utility E", "night_gap", "M", "INHOUSE"),
    ("PWR-06", "Power Utility F", "hard_neg_small", "S", "INHOUSE"),
    ("BFS-01", "Bank A", "healthy", "L", "INHOUSE"),
    ("BFS-02", "Bank B", "quick_closer", "L", "INHOUSE"),
    ("BFS-03", "Bank C", "sla_gamer", "L", "INHOUSE"),
    ("BFS-04", "Bank D", "hard_neg_soar", "L", "INHOUSE"),
    ("BFS-05", "Insurer E", "healthy", "M", "MSSP-2"),
    ("BFS-06", "Bank F", "late_reporter", "M", "INHOUSE"),
    ("TEL-01", "Telecom A", "healthy", "L", "INHOUSE"),
    ("TEL-02", "Telecom B", "template_writer", "M", "INHOUSE"),
    ("TEL-03", "Telecom C", "blind", "M", "MSSP-1"),
    ("TEL-04", "Telecom D", "healthy", "M", "INHOUSE"),
    ("TEL-05", "Telecom E", "clock_skew", "M", "INHOUSE"),
    ("TEL-06", "Telecom F", "healthy", "S", "MSSP-2"),
    ("TRN-01", "Transport A", "healthy", "M", "INHOUSE"),
    ("TRN-02", "Transport B", "silent_asset", "M", "INHOUSE"),
    ("TRN-03", "Transport C", "unescalated", "M", "INHOUSE"),
    ("TRN-04", "Transport D", "healthy", "M", "MSSP-3"),
    ("TRN-05", "Transport E", "healthy", "S", "MSSP-1"),
    ("TRN-06", "Transport F", "slow_decay", "M", "INHOUSE"),
    ("GOV-01", "Ministry A", "healthy", "M", "INHOUSE"),
    ("GOV-02", "Ministry B", "attrition", "M", "INHOUSE"),
    ("GOV-03", "Ministry C", "healthy", "M", "MSSP-3"),
    ("GOV-04", "Ministry D", "healthy", "S", "MSSP-3"),
    ("GOV-05", "Ministry E", "healthy", "M", "MSSP-2"),
    ("GOV-06", "Ministry F", "healthy", "S", "INHOUSE"),
    ("SPE-01", "Strategic PSU A", "healthy", "L", "INHOUSE"),
    ("SPE-02", "Strategic PSU B", "healthy", "M", "INHOUSE"),
    ("SPE-03", "Strategic PSU C", "retention_gap", "M", "INHOUSE"),
    ("SPE-04", "Strategic PSU D", "healthy", "M", "MSSP-3"),
    ("SPE-05", "Strategic PSU E", "healthy", "S", "MSSP-3"),
    ("SPE-06", "Strategic PSU F", "healthy", "M", "MSSP-2"),
    ("HLT-01", "Hospital Network A", "healthy", "M", "INHOUSE"),
    ("HLT-02", "Hospital Network B", "healthy", "M", "MSSP-1"),
    ("HLT-03", "Hospital Network C", "healthy", "M", "MSSP-3"),
    ("HLT-04", "Hospital Network D", "healthy", "S", "MSSP-3"),
    ("HLT-05", "Hospital Network E", "healthy", "M", "INHOUSE"),
    ("HLT-06", "Hospital Network F", "healthy", "M", "MSSP-2"),
]

# The weak managed-security provider: each client degrades a little, which is
# individually borderline but clear when pooled at the provider level (D11).
WEAK_PROVIDER = "MSSP-3"
WEAK_PROVIDER_EFFECT = dict(sup_base_add=0.07, boilerplate_share=0.30)

# Entities that submitted a red-team / drill report (D10)
REDTEAM_ENTITIES = ["PWR-01", "PWR-03", "TEL-03", "BFS-01", "TRN-01", "GOV-01"]


def params_for(archetype: str, provider: str) -> dict:
    p = dict(BASE)
    p.update(ARCHETYPES[archetype])
    if provider == WEAK_PROVIDER:
        p["sup_base"] += WEAK_PROVIDER_EFFECT["sup_base_add"]
        p["boilerplate_share"] = WEAK_PROVIDER_EFFECT["boilerplate_share"]
    return p
