"""Built-in quizzes (quizzes/*.json). A broken file is skipped with a warning, never fatal."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from .quiz import Quiz, validate_quiz

MAX_QUIZ_BYTES = 500 * 1024
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")


@dataclass
class LibraryQuiz:
    id: str
    quiz: Quiz

    def summary(self) -> dict:
        return {"id": self.id, "title": self.quiz.title, "rounds": len(self.quiz.rounds), "questions": self.quiz.question_count}


def load_library(directory: Path, extra: list[Path] | None = None) -> tuple[dict[str, LibraryQuiz], list[str]]:
    quizzes: dict[str, LibraryQuiz] = {}
    warnings: list[str] = []
    files = sorted(directory.glob("*.json")) if directory.is_dir() else []
    if not directory.is_dir():
        warnings.append(f"Can't read the quizzes folder {directory}")
    for path in [*files, *(extra or [])]:
        quiz_id = re.sub(r"[^a-z0-9-]+", "-", path.stem.lower())
        if not ID.match(quiz_id):
            warnings.append(f"{path.name}: skipped (file name must be letters, digits and dashes)")
            continue
        if quiz_id in quizzes:
            warnings.append(f'{path.name}: skipped (another quiz is already called "{quiz_id}")')
            continue
        try:
            if path.stat().st_size > MAX_QUIZ_BYTES:
                raise ValueError(f"it is bigger than {MAX_QUIZ_BYTES // 1024} KB")
            data = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as e:
            warnings += [f"{path.name} can't be read: {e}", f"{path.name}: skipped"]
            continue
        quiz, problems = validate_quiz(data)
        if quiz is None:
            warnings += [f"{path.name}: {p}" for p in problems[:10]] + [f"{path.name}: skipped"]
            continue
        quizzes[quiz_id] = LibraryQuiz(quiz_id, quiz)
    return quizzes, warnings
