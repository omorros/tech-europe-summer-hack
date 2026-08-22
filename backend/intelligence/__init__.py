"""Bill's lane — locked entry points per PRD section 3."""

from .briefing import make_briefing
from .extractor import on_transcript
from .route import plan_route

__all__ = ["on_transcript", "plan_route", "make_briefing"]
