import pytest

from app.config import settings


@pytest.fixture(autouse=True)
def _no_network_routing(monkeypatch):
    """Tests must never call the routing server; they opt in with their own fake router."""
    monkeypatch.setattr(settings, "ROUTING_ENABLED", False)


@pytest.fixture(scope="session")
def trained_eta():
    """One trained ETA model shared by the whole test run (training takes a few seconds)."""
    from app.ml.models import ETAPredictor
    model = ETAPredictor()
    model.train()
    return model
