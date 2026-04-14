---
name: python-pro
description: Python 3.11+, async, type hints, dataclasses, virtual envs
context: fork
paths: ["**/*.py"]
requires:
  bins: ["python3"]
---

# Python Pro

## Rules
- Use type hints everywhere. `from __future__ import annotations` at top.
- Use `dataclasses` or `pydantic` for data structures (not plain dicts).
- Use `pathlib.Path` instead of `os.path`.
- Use `asyncio` for I/O-bound operations.
- Use virtual environments (`venv` or `uv`).
- Use f-strings for string formatting.

## Error Handling
- Catch specific exceptions, never bare `except:`.
- Use `contextlib.suppress` for expected exceptions.
- Raise custom exceptions with descriptive messages.

## Testing
- Use `pytest` with parametrized tests.
- Use `pytest-asyncio` for async tests.
- Use `pytest-cov` for coverage (80% minimum).

## Package Management
- Use `pyproject.toml` (not `setup.py`).
- Pin dependencies in `requirements.txt` or `uv.lock`.
- Use `ruff` for linting and formatting.
