"""Print the quiz format as JSON Schema (used to generate the frontend's TypeScript types).

python -m trivvoly.schema
"""
import json

from .quiz import Quiz

if __name__ == "__main__":
    print(json.dumps(Quiz.model_json_schema(mode="serialization"), indent=1))
