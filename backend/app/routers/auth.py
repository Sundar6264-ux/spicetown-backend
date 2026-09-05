import json
from typing import List, Optional

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import (
    clear_session_cookie,
    create_session,
    delete_all_sessions_for_user,
    delete_session,
    extract_bearer_token,
    get_current_user,
    hash_password,
    require_admin,
    set_session_cookie,
    verify_password,
    SESSION_COOKIE_NAME,
)
from app.db import get_db
from app.features import FEATURE_KEYS, FEATURES, get_allowed_features
from app.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=8)
    is_admin: bool = False
    # Ignored when is_admin=True (an admin always has full access) - for a
    # non-admin, defaults to no access at all until the admin creating the
    # account explicitly grants some.
    allowed_features: List[str] = []


class SetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8)


class SetFeaturesRequest(BaseModel):
    allowed_features: List[str]


def _user_out(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "is_admin": user.is_admin,
        "allowed_features": get_allowed_features(user),
    }


def _clean_features(keys: List[str]) -> str:
    unknown = [k for k in keys if k not in FEATURE_KEYS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown feature key(s): {', '.join(unknown)}")
    # De-dup while preserving the canonical FEATURES order, for a stable stored value.
    keep = set(keys)
    return json.dumps([f["key"] for f in FEATURES if f["key"] in keep])


@router.post("/login")
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.username == body.username)).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    token, expires_at = create_session(db, user.id)
    set_session_cookie(response, token, expires_at)
    return _user_out(user)


@router.post("/mobile-login")
def mobile_login(body: LoginRequest, db: Session = Depends(get_db)):
    """Same credential check as /login, but for the mobile app: no cookie is
    set (a Capacitor WebView doesn't carry it reliably, and biometric re-auth
    needs an explicit value to store in Keychain/Keystore anyway) - the raw
    session token is returned in the body instead, sent back by the client as
    `Authorization: Bearer <token>` on every request. Deliberately a separate
    endpoint rather than adding `token` to /login's response: doing that
    there would hand any web-page XSS a readable-by-JS token where today only
    an httpOnly cookie exists, a real regression to the web app's security
    model for no benefit to it.
    """
    user = db.execute(select(User).where(User.username == body.username)).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    token, expires_at = create_session(db, user.id)
    return {"token": token, "expires_at": expires_at.isoformat(), **_user_out(user)}


@router.post("/logout")
def logout(
    response: Response,
    db: Session = Depends(get_db),
    session_token: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    authorization: Optional[str] = Header(default=None),
):
    token = session_token or extract_bearer_token(authorization)
    if token:
        delete_session(db, token)
    clear_session_cookie(response)
    return {"status": "ok"}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return _user_out(user)


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    user.password_hash = hash_password(body.new_password)
    db.add(user)
    db.commit()
    return {"status": "ok"}


@router.get("/users")
def list_users(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.execute(select(User).order_by(User.username)).scalars().all()
    return [_user_out(u) for u in users]


@router.post("/users")
def create_user(
    body: CreateUserRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    existing = db.execute(select(User).where(User.username == body.username)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="That username is already taken")

    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        is_admin=body.is_admin,
        allowed_features=_clean_features(body.allowed_features),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.get("/features")
def list_features(_: User = Depends(require_admin)):
    """The full catalog of admin-grantable dashboard features, for rendering
    the permission checklist on the Users page. Admin-only, same as the rest
    of user management - a non-admin has no reason to see the full catalog,
    only their own granted subset (already returned by /me).
    """
    return {"features": FEATURES}


@router.patch("/users/{user_id}/features")
def set_user_features(
    user_id: int,
    body: SetFeaturesRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    target.allowed_features = _clean_features(body.allowed_features)
    db.add(target)
    db.commit()
    db.refresh(target)
    return _user_out(target)


@router.post("/users/{user_id}/set-password")
def set_user_password(
    user_id: int,
    body: SetPasswordRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    target.password_hash = hash_password(body.new_password)
    db.add(target)
    db.commit()
    # Force re-login everywhere for that account - an old session shouldn't
    # keep working once the password's been changed out from under it.
    delete_all_sessions_for_user(db, user_id)
    return {"status": "ok"}
