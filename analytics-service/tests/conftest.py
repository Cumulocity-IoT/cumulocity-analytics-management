"""
Test configuration and fixtures for analytics-service
"""

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


def pytest_configure(config):
    """Configure pytest"""
    os.environ['TESTING'] = 'true'
    os.environ['LOG_LEVEL'] = 'DEBUG'


@pytest.fixture
def agent_mock(monkeypatch):
    """Replace the module-level C8YAgent in app.py with a mock (no Cumulocity access)."""
    import app as app_module

    mock = MagicMock(name="agent")
    monkeypatch.setattr(app_module, "agent", mock)
    return mock


@pytest.fixture
def client(agent_mock):
    """Flask test client with a mocked Cumulocity agent."""
    import app as app_module

    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


@pytest.fixture
def fake_response():
    """Factory for minimal `requests.Response` look-alike."""

    def _make(status=200, json_data=None, text="", content=None, headers=None):
        resp = MagicMock()
        resp.status_code = status
        resp.ok = 200 <= status < 300
        resp.headers = headers or {}
        resp.text = text
        resp.content = content if content is not None else text.encode()
        if json_data is None:
            resp.json.side_effect = ValueError("no json")
        else:
            resp.json.return_value = json_data
        if resp.ok:
            resp.raise_for_status.return_value = None
        else:
            from requests.exceptions import HTTPError

            resp.raise_for_status.side_effect = HTTPError(
                f"{status} error", response=resp
            )
        return resp

    return _make


@pytest.fixture
def run_agent_work(monkeypatch):
    """Make C8YAgent._execute run its async work against a supplied fake tenant."""
    from c8y_agent import C8YAgent

    def _install(agent, tenant):
        monkeypatch.setattr(
            agent, "_execute", lambda request, work, service=False: asyncio.run(work(tenant))
        )
        return agent

    return _install
