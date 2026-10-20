"""Print the server's data contract as JSON Schema: the quiz format plus every view the screens
receive. The frontend generates its TypeScript types from this (npm run gen:types).

python -m trivvoly.schema
"""
import json

from pydantic import BaseModel

from .quiz import Quiz
from .views import HostView, PlayerView, RoomInfo


class Contract(BaseModel):
    """Everything the frontend receives from the server."""
    quiz: Quiz
    hostView: HostView
    playerView: PlayerView
    room: RoomInfo


if __name__ == "__main__":
    print(json.dumps(Contract.model_json_schema(mode="serialization"), indent=1))
