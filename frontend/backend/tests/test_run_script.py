"""Tests for frontend/run.sh startup script."""

import os
import stat
from pathlib import Path


def test_run_script_exists():
    """Test that run.sh exists in the frontend directory."""
    script_path = Path(__file__).parent.parent.parent / "run.sh"
    assert script_path.exists(), "frontend/run.sh should exist"


def test_run_script_is_executable():
    """Test that run.sh has executable permissions."""
    script_path = Path(__file__).parent.parent.parent / "run.sh"
    file_stat = os.stat(script_path)
    is_executable = bool(file_stat.st_mode & stat.S_IXUSR)
    assert is_executable, "frontend/run.sh should be executable"


def test_run_script_has_bash_shebang():
    """Test that run.sh starts with #!/bin/bash."""
    script_path = Path(__file__).parent.parent.parent / "run.sh"
    with open(script_path) as f:
        first_line = f.readline().strip()
    assert first_line == "#!/bin/bash", "frontend/run.sh should start with #!/bin/bash"


def test_run_script_contains_required_commands():
    """Test that run.sh contains the required commands."""
    script_path = Path(__file__).parent.parent.parent / "run.sh"
    with open(script_path) as f:
        content = f.read()

    # Check for required command sequences
    assert "cd frontend/web" in content, "Script should navigate to frontend/web"
    assert "npm install" in content, "Script should run npm install"
    assert "npm run build" in content, "Script should run npm run build"
    assert "uvicorn frontend.backend.main:app --host 0.0.0.0 --port 8000" in content, \
        "Script should start uvicorn with correct parameters"

    # Check for required print messages
    assert "Backend running at http://localhost:8000" in content, \
        "Script should print backend URL"
    assert "Open http://localhost:8000 in your browser" in content, \
        "Script should print instructions to open browser"
