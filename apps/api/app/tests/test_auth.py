import json
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm

from app.auth.dev import ROLE_PLATFORM_ADMIN, ROLE_REVIEWER, ROLE_VIEWER, user_from_cognito_claims
from app.auth import dev as auth_dev
from app.config import Settings
from app.config import get_settings
from app.main import app


def test_cognito_group_maps_to_platform_admin() -> None:
    settings = Settings(
        AUTH_MODE="cognito",
        COGNITO_ADMIN_GROUP="cloudops-admins",
        COGNITO_REVIEWER_GROUP="cloudops-reviewers",
        COGNITO_VIEWER_GROUP="cloudops-viewers",
        COGNITO_ORG_CLAIM="custom:org_id",
    )
    user = user_from_cognito_claims(
        {
            "sub": "user-123",
            "email": "lead@example.com",
            "name": "Platform Lead",
            "cognito:groups": ["cloudops-admins"],
            "custom:org_id": "acme",
        },
        settings,
    )

    assert user.auth_provider == "cognito"
    assert user.id == "user-123"
    assert user.email == "lead@example.com"
    assert user.name == "Platform Lead"
    assert user.role == ROLE_PLATFORM_ADMIN
    assert user.org_id == "acme"


def test_cognito_group_maps_to_reviewer() -> None:
    settings = Settings(AUTH_MODE="cognito", COGNITO_REVIEWER_GROUP="cloudops-reviewers")
    user = user_from_cognito_claims(
        {
            "sub": "user-456",
            "email": "reviewer@example.com",
            "cognito:groups": ["cloudops-reviewers"],
        },
        settings,
    )

    assert user.role == ROLE_REVIEWER


def test_cognito_unknown_group_defaults_to_viewer() -> None:
    settings = Settings(AUTH_MODE="cognito")
    user = user_from_cognito_claims(
        {
            "sub": "user-789",
            "email": "viewer@example.com",
            "cognito:groups": ["finance"],
        },
        settings,
    )

    assert user.role == ROLE_VIEWER


def test_cognito_mode_requires_and_accepts_signed_bearer_token(monkeypatch) -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    kid = "test-key"
    jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    jwk["kid"] = kid
    settings = Settings(
        AUTH_MODE="cognito",
        COGNITO_REGION="us-east-1",
        COGNITO_USER_POOL_ID="pool-123",
        COGNITO_APP_CLIENT_ID="client-123",
        COGNITO_REVIEWER_GROUP="cloudops-reviewers",
    )
    claims = {
        "iss": settings.resolved_cognito_issuer,
        "sub": "cognito-sub",
        "email": "reviewer@example.com",
        "name": "Review Lead",
        "token_use": "access",
        "client_id": "client-123",
        "cognito:groups": ["cloudops-reviewers"],
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
    }
    token = jwt.encode(claims, key, algorithm="RS256", headers={"kid": kid})

    async def fake_key_for_kid(_: str, requested_kid: str):
        assert requested_kid == kid
        return jwk

    monkeypatch.setattr(auth_dev._jwks_cache, "key_for_kid", fake_key_for_kid)
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        with TestClient(app) as client:
            missing = client.get("/api/v1/auth/me")
            allowed = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    finally:
        app.dependency_overrides.clear()

    assert missing.status_code == 401
    assert allowed.status_code == 200
    assert allowed.json()["auth_provider"] == "cognito"
    assert allowed.json()["role"] == ROLE_REVIEWER
