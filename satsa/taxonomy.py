"""Shared vocabulary: sectors, asset classes, ATT&CK tactics, log sources,
PS capabilities and the regulatory crosswalk. Everything else imports from here."""

from __future__ import annotations

# NCIIPC critical sectors (IT Act s.70A)
SECTORS = {
    "PWR": "Power & Energy",
    "BFS": "Banking, Financial Services & Insurance",
    "TEL": "Telecom",
    "TRN": "Transport",
    "GOV": "Government",
    "SPE": "Strategic & Public Enterprises",
    "HLT": "Health",
}

# ATT&CK Enterprise tactics (display order)
TACTICS = [
    "Reconnaissance", "Resource Development", "Initial Access", "Execution",
    "Persistence", "Privilege Escalation", "Defense Evasion", "Credential Access",
    "Discovery", "Lateral Movement", "Collection", "Command and Control",
    "Exfiltration", "Impact",
]

# Alert categories -> (tactic, representative technique id, technique name)
CATEGORIES = {
    "phishing":            ("Initial Access", "T1566", "Phishing"),
    "exploit_public_app":  ("Initial Access", "T1190", "Exploit Public-Facing Application"),
    "malicious_script":    ("Execution", "T1059", "Command and Scripting Interpreter"),
    "new_service":         ("Persistence", "T1543", "Create or Modify System Process"),
    "sched_task":          ("Persistence", "T1053", "Scheduled Task/Job"),
    "priv_escalation":     ("Privilege Escalation", "T1068", "Exploitation for Privilege Escalation"),
    "log_tamper":          ("Defense Evasion", "T1070", "Indicator Removal"),
    "brute_force":         ("Credential Access", "T1110", "Brute Force"),
    "credential_dump":     ("Credential Access", "T1003", "OS Credential Dumping"),
    "network_scan":        ("Discovery", "T1046", "Network Service Discovery"),
    "port_scan_external":  ("Reconnaissance", "T1595", "Active Scanning"),
    "lateral_rdp_smb":     ("Lateral Movement", "T1021", "Remote Services"),
    "data_staging":        ("Collection", "T1074", "Data Staged"),
    "c2_beacon":           ("Command and Control", "T1071", "Application Layer Protocol"),
    "dns_tunnel":          ("Command and Control", "T1071.004", "DNS"),
    "exfil_large_upload":  ("Exfiltration", "T1048", "Exfiltration Over Alternative Protocol"),
    "ransomware_behavior": ("Impact", "T1486", "Data Encrypted for Impact"),
    "ot_unauth_command":   ("Impact", "T0855", "Unauthorized Command Message (ICS)"),
    "malware_detected":    ("Execution", "T1204", "User Execution"),
    "policy_violation":    ("Defense Evasion", "T1562", "Impair Defenses"),
}

# Which log sources can *support* detecting each category. A category is
# supportable for an entity if it submits at least one of these sources.
# Curated from ATT&CK data sources (process creation, logon session,
# network traffic, etc.) - see docs/ARCHITECTURE.md.
CATEGORY_SOURCES = {
    "phishing": {"email_gw", "edr"},
    "exploit_public_app": {"waf", "firewall", "edr"},
    "malicious_script": {"edr"},
    "new_service": {"edr"},
    "sched_task": {"edr"},
    "priv_escalation": {"edr", "auth_logs"},
    "log_tamper": {"edr", "siem_health"},
    "brute_force": {"auth_logs", "vpn"},
    "credential_dump": {"edr"},
    "network_scan": {"netflow", "ids", "firewall"},
    "port_scan_external": {"firewall", "ids"},
    "lateral_rdp_smb": {"edr", "netflow"},
    "data_staging": {"edr"},
    "c2_beacon": {"proxy", "netflow", "ids"},
    "dns_tunnel": {"dns"},
    "exfil_large_upload": {"proxy", "netflow", "firewall"},
    "ransomware_behavior": {"edr"},
    "ot_unauth_command": {"ot_ids"},
    "malware_detected": {"edr", "av"},
    "policy_violation": {"edr", "siem_health"},
}

LOG_SOURCES = {
    "edr": "EDR (process creation, module load, file events)",
    "av": "Antivirus",
    "auth_logs": "Authentication / directory logs",
    "vpn": "VPN logs",
    "netflow": "Network flow records",
    "ids": "Network IDS",
    "firewall": "Firewall logs",
    "waf": "Web application firewall",
    "proxy": "Web proxy",
    "dns": "DNS query logs",
    "email_gw": "Email gateway",
    "ot_ids": "OT / ICS network monitoring",
    "siem_health": "SIEM / agent health telemetry",
}

TACTIC_OF = {c: v[0] for c, v in CATEGORIES.items()}


def supportable_tactics(sources: set[str]) -> dict[str, list[str]]:
    """tactic -> list of categories the given log sources can support."""
    out: dict[str, list[str]] = {t: [] for t in TACTICS}
    for cat, need in CATEGORY_SOURCES.items():
        if need & sources:
            out[TACTIC_OF[cat]].append(cat)
    return out


# Asset classes: (display name, criticality 1-4, typical categories, sectors or None=all)
ASSET_CLASSES = {
    "ad_dc":          ("Active Directory DC", 4, None),
    "firewall":       ("Perimeter firewall", 3, None),
    "email_gw":       ("Email gateway", 3, None),
    "web_server":     ("Public web server", 3, None),
    "db_server":      ("Database server", 3, None),
    "vpn_gw":         ("VPN gateway", 3, None),
    "endpoint":       ("Workstation fleet segment", 2, None),
    "file_server":    ("File server", 2, None),
    "scada_hmi":      ("SCADA HMI", 4, {"PWR", "TRN"}),
    "rtu_gateway":    ("RTU / control-system gateway", 4, {"PWR"}),
    "historian":      ("Plant historian", 3, {"PWR"}),
    "core_banking":   ("Core banking DB", 4, {"BFS"}),
    "payment_switch": ("Payment switch", 4, {"BFS"}),
    "swift_gw":       ("SWIFT gateway", 4, {"BFS"}),
    "hlr_hss":        ("HLR / HSS subscriber DB", 4, {"TEL"}),
    "core_router":    ("Core router", 4, {"TEL"}),
    "bss":            ("Billing / BSS", 3, {"TEL"}),
    "signalling":     ("Signalling system", 4, {"TRN"}),
    "ticketing":      ("Ticketing platform", 3, {"TRN"}),
    "eoffice":        ("e-Office platform", 3, {"GOV"}),
    "citizen_portal": ("Citizen services portal", 4, {"GOV"}),
    "classified_lan": ("Restricted LAN gateway", 4, {"SPE"}),
    "erp":            ("ERP", 3, {"SPE", "GOV"}),
    "his":            ("Hospital information system", 4, {"HLT"}),
    "pacs":           ("PACS imaging", 3, {"HLT"}),
}

# Problem-statement capabilities (PS "Description/Background" i-viii)
CAPABILITIES = [
    "Threat Detection", "Investigation", "Escalation", "Incident Response",
    "Security Operations", "Governance & Oversight", "Operational Discipline",
    "Cyber Resilience",
]

# Regulatory crosswalk: detector id -> list of obligations it tests
REGMAP = {
    "TW1": ["SEBI CSCRF - SOC functional efficacy (sustained performance)", "NCIIPC guidelines - continuous improvement"],
    "EG1": ["SEBI CSCRF - SOC functional efficacy: Detective Effectiveness",
            "NCIIPC guidelines - incident handling"],
    "EG2": ["SEBI CSCRF - Detective Effectiveness", "CEA 2024 - Cyber Crisis Management Plan escalation"],
    "EG3": ["SEBI CSCRF - 'Whether qualified personnel are deployed in SOC?'"],
    "EG4": ["SEBI CSCRF - 'Whether IOCs are processed by SOC?'", "NCIIPC guidelines - incident handling"],
    "EG5": ["SEBI CSCRF - Policy Compliance (approved SOPs)", "RBI IT-GRCA 2023 - SOC process controls"],
    "EG6": ["SEBI CSCRF - Detective Effectiveness (metric integrity)"],
    "EG7": ["CERT-In Directions 2022 - remediation of reported incidents", "NCIIPC guidelines - root-cause remediation"],
    "EG11": ["SEBI CSCRF - 'Whether monitoring through SOC is done round-the-clock?'", "RBI IT-GRCA 2023 - 24x7 SOC"],
    "EG12": ["CERT-In Directions 2022 - report incidents within 6 hours", "CEA 2024 - reporting to CERT-In / NCIIPC / CSIRT-Power"],
    "EG13": ["SEBI CSCRF - 'Whether threat intelligence is received and acted upon?'"],
    "NS1": ["SEBI CSCRF - Environment Coverage (coverage of assets w.r.t. SOC technologies)"],
    "NS2": ["SEBI CSCRF - 'Whether SOC rules and use-cases detect relevant attacks?'"],
    "NS3": ["SEBI CSCRF - 'Quality of logs ingested in SOC (source, frequency, verbosity)'",
            "SEBI CSCRF - monitoring of network traffic and endpoints"],
    "NS5": ["SEBI CSCRF - Detective Effectiveness (rule tuning governance)"],
    "NS8": ["CERT-In Directions 2022 - 180-day rolling log retention", "DPDP Rules 2025 - processing logs >= 1 year"],
    "NS9": ["CERT-In Directions 2022 - clock synchronisation to NIC/NPL NTP"],
    "RT1": ["SEBI CSCRF / CEA 2024 - red-team exercises and drills"],
    "AN1": ["NCIIPC guidelines - continuous improvement"],
}
