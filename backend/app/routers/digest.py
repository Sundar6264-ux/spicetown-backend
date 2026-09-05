import anthropic
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.features import require_feature
from app.db import get_db
from app.services.anthropic_client import AnthropicNotConfigured
from app.services.weekly_digest import generate_weekly_digest

router = APIRouter(prefix="/api/weekly-digest", tags=["weekly-digest"], dependencies=[Depends(require_feature("overview"))])


@router.post("/generate")
def generate(db: Session = Depends(get_db)):
    try:
        return generate_weekly_digest(db)
    except AnthropicNotConfigured:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY isn't configured on the server - set it in backend/.env and "
            "restart the service.",
        )
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY was rejected by the Claude API.")
    except anthropic.APIError as exc:
        raise HTTPException(status_code=502, detail=f"Claude API error: {exc}")
