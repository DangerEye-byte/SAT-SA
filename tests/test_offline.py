"""Air-gap test: with every outbound network connection blocked, SAT-SA generates a panel,
runs the full analysis and answers API calls. Run:  python -m pytest tests/test_offline.py -q"""

import socket

import duckdb
import pytest


@pytest.fixture
def no_network(monkeypatch):
    attempts = []

    def blocked(self, address, *a, **k):
        attempts.append(address)
        raise OSError(f"network blocked by test (tried {address})")

    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked)
    monkeypatch.setattr(socket, "create_connection", lambda *a, **k: blocked(None, a[0] if a else None))
    return attempts


def test_full_analysis_offline(no_network, tmp_path):
    from satsa.eval.panels import null_roster
    from satsa.gen.generator import generate
    from satsa.pipeline import analyze, provider_lens, survival

    generate(tmp_path, seed=5, roster=null_roster()[:12], rate_scale=0.1)
    a = analyze(duckdb.connect(":memory:"), tmp_path, quarters=True)
    assert len(a["scores"]) == 12 and a["scores"].p_value.between(0, 1).all()
    assert len(provider_lens(a["cf"], a["ctx"].entities)) > 0
    assert len(survival(a["cf"], a["ctx"].period_end)) > 0
    assert no_network == []


def test_explanations_and_gaming_offline(no_network):
    from satsa.ai.explain import template_explanation, verify
    from satsa.eval.gaming import timeline
    pack = {"facts": {"detector": "EG1", "name": "x"}, "reason": "r",
            "records": [{"id": "C1", "fields": "ttc_min=3.0", "note": "", "injection_like": False}]}
    assert verify(template_explanation(pack), pack)["verified_claims"]
    assert len(timeline("attrition", "satsa_analytics")["trace"]) == 12
    assert no_network == []
