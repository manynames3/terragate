from app.services.risk import score_risk


def test_risk_scoring_applies_production_multiplier_and_public_exposure() -> None:
    findings = [
        {
            "severity": "high",
            "title": "Public ingress exposes sensitive service",
            "resource_type": "aws_security_group",
            "resource_address": "aws_security_group.web",
            "change_actions": ["create"],
            "evidence": [{"observed_value": "0.0.0.0/0"}],
            "confidence": 0.95,
        }
    ]

    result = score_risk(findings, "prod")

    assert result["overall_score"] >= 67
    assert result["risk_level"] in {"high", "critical"}
    assert result["top_drivers"]
