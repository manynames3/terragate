import json
from pathlib import Path

from app.services.blast_radius import analyze_blast_radius
from app.services.cost_estimator import estimate_cost_delta
from app.services.policy_packs import list_policy_packs, load_policy_pack
from app.services.terraform_plan import extract_resource_changes


ROOT = Path(__file__).resolve().parents[4]


def _plan(name: str) -> dict:
    return json.loads((ROOT / "sample-data" / "terraform-plans" / name).read_text())


def test_policy_packs_are_configurable() -> None:
    packs = {pack["name"]: pack for pack in list_policy_packs()}

    assert "default" in packs
    assert "restricted" in packs
    assert packs["restricted"]["max_monthly_delta"] < packs["default"]["max_monthly_delta"]


def test_cost_estimator_flags_large_monthly_delta() -> None:
    changes = extract_resource_changes(_plan("risky-cost-plan.json"))
    estimate = estimate_cost_delta(changes, load_policy_pack("startup_cost_control"))

    assert estimate["monthly_delta"] > 0
    assert estimate["over_threshold"] is True
    assert estimate["source"] in {"heuristic_fallback", "infracost_cli"}
    assert estimate["line_items"][0]["monthly_delta"] >= estimate["line_items"][-1]["monthly_delta"]


def test_blast_radius_scores_destructive_stateful_prod_changes() -> None:
    changes = extract_resource_changes(_plan("destructive-prod-plan.json"))
    blast_radius = analyze_blast_radius(changes, "prod")

    assert blast_radius["level"] == "critical"
    assert blast_radius["stateful_changes"]
    assert "backup retention missing" in blast_radius["stateful_changes"][0]["factors"]
    assert blast_radius["stateful_changes"][0]["rollback_checklist"]
