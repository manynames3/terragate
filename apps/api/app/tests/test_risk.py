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

    result = score_risk(
        findings,
        "prod",
        cost_estimate={"monthly_delta": 240, "threshold": 500},
        blast_radius={"stateful_changes": []},
    )

    assert result["overall_score"] == 50
    assert result["risk_level"] == "high"
    assert result["top_drivers"]


def test_risk_scoring_separates_security_cost_and_stateful_scenarios() -> None:
    security_findings = [
        {
            "severity": "high",
            "title": "Public ingress exposes sensitive service",
            "resource_address": f"aws_security_group.web_{index}",
            "resource_type": "aws_security_group",
            "change_actions": ["create"],
            "evidence": [{"observed_value": "0.0.0.0/0"}],
            "confidence": 0.95,
        }
        for index in range(5)
    ]
    cost_findings = (
        [
            {
                "severity": "high",
                "category": "cost",
                "title": "Estimated monthly cost delta exceeds policy threshold",
            }
        ]
        + [{"severity": "medium", "category": "cost", "title": f"Medium cost signal {index}"} for index in range(8)]
        + [{"severity": "low", "category": "governance", "title": f"Low governance signal {index}"} for index in range(9)]
    )
    destructive_findings = (
        [
            {"severity": "critical", "title": "Production stateful deletion blocked by policy"},
            {"severity": "critical", "title": "Production stateful deletion blocked by policy"},
        ]
        + [{"severity": "high", "title": f"High reliability signal {index}"} for index in range(6)]
        + [
            {
                "severity": "medium",
                "title": "Resource type outside restricted policy profile",
                "evidence": [
                    {
                        "json_path": "$.resource_changes[1].type",
                        "observed_value": "aws_efs_file_system",
                        "expected_value": '["aws_s3_bucket_public_access_block"]',
                    }
                ],
            },
            {"severity": "medium", "title": "Production RDS appears single-AZ"},
        ]
        + [{"severity": "low", "title": f"Low governance signal {index}"} for index in range(2)]
    )

    security = score_risk(
        security_findings,
        "prod",
        cost_estimate={"monthly_delta": 240, "threshold": 500},
        blast_radius={"stateful_changes": []},
    )
    cost = score_risk(
        cost_findings,
        "staging",
        cost_estimate={"monthly_delta": 717.72, "threshold": 250},
        blast_radius={"stateful_changes": []},
    )
    destructive = score_risk(
        destructive_findings,
        "prod",
        cost_estimate={"monthly_delta": 240, "threshold": 0},
        blast_radius={
            "stateful_changes": [
                {"resource_address": "aws_db_instance.primary", "severity": "critical"},
                {"resource_address": "aws_efs_file_system.shared", "severity": "critical"},
            ]
        },
    )

    assert security["overall_score"] == 82
    assert security["risk_level"] == "critical"
    assert cost["overall_score"] == 65
    assert cost["risk_level"] == "high"
    assert destructive["overall_score"] == 96
    assert destructive["risk_level"] == "critical"
