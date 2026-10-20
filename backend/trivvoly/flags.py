"""Built-in flag library. Quizzes refer to flags by id ("flag": "estonia"), never by markup."""
import json
from pathlib import Path

FLAGS_FILE = Path(__file__).resolve().parents[2] / "shared" / "flags.json"
FLAGS: dict[str, dict] = json.loads(FLAGS_FILE.read_text(encoding="utf-8"))
