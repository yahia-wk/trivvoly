"""Shared test setup. Tests use a fresh SQLite file each; set TEST_DATABASE_URL to a Postgres URL
(e.g. postgresql+psycopg://trivvoly:trivvoly@localhost:5433/trivvoly) to run them against Postgres."""
import os

import pytest
from sqlalchemy import create_engine

from trivvoly.db import Base


@pytest.fixture
def database_url(tmp_path):
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        return f"sqlite:///{tmp_path / 'test.db'}"
    engine = create_engine(url)
    Base.metadata.drop_all(engine)  # every test starts empty
    engine.dispose()
    return url
