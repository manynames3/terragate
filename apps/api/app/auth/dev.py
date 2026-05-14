from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Annotated, Any

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import InvalidTokenError

from app.config import Settings, get_settings


ROLE_PLATFORM_ADMIN = "platform-admin"
ROLE_REVIEWER = "reviewer"
ROLE_VIEWER = "viewer"
VALID_ROLES = {ROLE_PLATFORM_ADMIN, ROLE_REVIEWER, ROLE_VIEWER}


@dataclass
class DevUser:
    id: str | None = None
    email: str = "dev@cloudops.local"
    name: str = "Dev Reviewer"
    role: str = ROLE_PLATFORM_ADMIN
    org_id: str | None = "dev"
    groups: list[str] = field(default_factory=list)
    auth_provider: str = "dev"


class CognitoJwksCache:
    def __init__(self) -> None:
        self._keys_by_url: dict[str, tuple[float, dict[str, dict[str, Any]]]] = {}

    async def key_for_kid(self, jwks_url: str, kid: str) -> dict[str, Any]:
        now = time.time()
        expires_at, keys = self._keys_by_url.get(jwks_url, (0.0, {}))
        if expires_at <= now or kid not in keys:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(jwks_url)
                response.raise_for_status()
            payload = response.json()
            keys = {
                str(item.get("kid")): item
                for item in payload.get("keys", [])
                if item.get("kid")
            }
            self._keys_by_url[jwks_url] = (now + 3600, keys)
        if kid not in keys:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Cognito token key id was not found in the configured JWKS.",
            )
        return keys[kid]


_jwks_cache = CognitoJwksCache()


async def get_current_user(
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    x_cloudops_user_email: Annotated[str | None, Header(alias="X-CloudOps-User-Email")] = None,
    x_cloudops_user_name: Annotated[str | None, Header(alias="X-CloudOps-User-Name")] = None,
    x_cloudops_role: Annotated[str | None, Header(alias="X-CloudOps-Role")] = None,
    settings: Settings = Depends(get_settings),
) -> DevUser:
    if settings.auth_mode.lower() == "cognito":
        return await _get_cognito_user(authorization, settings)
    return _get_dev_user(x_cloudops_user_email, x_cloudops_user_name, x_cloudops_role)


def _get_dev_user(email_header: str | None, name_header: str | None, role_header: str | None) -> DevUser:
    email = (email_header or "dev@cloudops.local").strip()
    role = (role_header or ROLE_PLATFORM_ADMIN).strip()
    if role not in VALID_ROLES:
        role = ROLE_VIEWER
    return DevUser(
        id=email,
        email=email,
        name=(name_header or email.split("@")[0] or "Dev Reviewer").strip(),
        role=role,
        org_id="dev",
        groups=[role],
        auth_provider="dev",
    )


async def _get_cognito_user(authorization: str | None, settings: Settings) -> DevUser:
    token = _bearer_token(authorization)
    issuer = settings.resolved_cognito_issuer
    jwks_url = settings.resolved_cognito_jwks_url
    if not issuer or not jwks_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Cognito auth is enabled but COGNITO_REGION/COGNITO_USER_POOL_ID or COGNITO_ISSUER is not configured.",
        )
    try:
        header = jwt.get_unverified_header(token)
        kid = str(header.get("kid") or "")
        if not kid:
            raise InvalidTokenError("Missing token kid.")
        jwk = await _jwks_cache.key_for_kid(jwks_url, kid)
        signing_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"verify_aud": False},
        )
        _validate_cognito_client(claims, settings)
        return user_from_cognito_claims(claims, settings)
    except HTTPException:
        raise
    except (InvalidTokenError, httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Cognito token: {exc}",
        ) from exc


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization bearer token.",
        )
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must use Bearer token format.",
        )
    return token.strip()


def _validate_cognito_client(claims: dict[str, Any], settings: Settings) -> None:
    token_use = str(claims.get("token_use") or "")
    if token_use not in {"access", "id"}:
        raise InvalidTokenError("Cognito token_use must be access or id.")
    client_id = settings.cognito_app_client_id
    if not client_id:
        return
    if token_use == "id" and claims.get("aud") != client_id:
        raise InvalidTokenError("Cognito ID token audience does not match COGNITO_APP_CLIENT_ID.")
    if token_use == "access" and claims.get("client_id") != client_id:
        raise InvalidTokenError("Cognito access token client_id does not match COGNITO_APP_CLIENT_ID.")


def user_from_cognito_claims(claims: dict[str, Any], settings: Settings) -> DevUser:
    groups = _normalize_groups(claims.get("cognito:groups"))
    role = _role_from_claims(claims, groups, settings)
    email = str(
        claims.get("email")
        or claims.get("username")
        or claims.get("cognito:username")
        or claims.get("sub")
        or "cognito-user"
    )
    name = str(claims.get("name") or _name_from_claims(claims) or email.split("@")[0])
    org_id = claims.get(settings.cognito_org_claim) or claims.get("custom:tenant_id") or claims.get("tenant_id")
    return DevUser(
        id=str(claims.get("sub") or email),
        email=email,
        name=name,
        role=role,
        org_id=str(org_id) if org_id else None,
        groups=groups,
        auth_provider="cognito",
    )


def _normalize_groups(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return []


def _name_from_claims(claims: dict[str, Any]) -> str | None:
    parts = [claims.get("given_name"), claims.get("family_name")]
    value = " ".join(str(part).strip() for part in parts if part)
    return value or None


def _role_from_claims(claims: dict[str, Any], groups: list[str], settings: Settings) -> str:
    explicit = claims.get("custom:role") or claims.get("role")
    if isinstance(explicit, str) and explicit in VALID_ROLES:
        return explicit
    group_set = set(groups)
    if group_set.intersection({settings.cognito_admin_group, ROLE_PLATFORM_ADMIN, "admins"}):
        return ROLE_PLATFORM_ADMIN
    if group_set.intersection({settings.cognito_reviewer_group, ROLE_REVIEWER, "reviewers"}):
        return ROLE_REVIEWER
    if group_set.intersection({settings.cognito_viewer_group, ROLE_VIEWER, "viewers"}):
        return ROLE_VIEWER
    return ROLE_VIEWER


def require_role(user: DevUser, allowed_roles: set[str]) -> None:
    if user.role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role '{user.role}' is not allowed to perform this action.",
        )
