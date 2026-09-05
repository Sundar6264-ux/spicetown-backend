import anthropic
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.features import require_feature
from app.db import get_db
from app.schemas import AskRequest
from app.services.anthropic_client import AnthropicNotConfigured
from app.services.ask_bot import ask

router = APIRouter(prefix="/api/ask", tags=["ask"], dependencies=[Depends(require_feature("ask_bot"))])


@router.post("")
def ask_question(body: AskRequest, db: Session = Depends(get_db)):
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    history = [{"role": turn.role, "content": turn.content} for turn in body.history]
    try:
        return ask(db, body.question, history)
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
