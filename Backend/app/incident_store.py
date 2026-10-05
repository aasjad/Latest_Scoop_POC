"""Loads the project's shared incident database layer (../../db.py).

db.py lives at the project root, next to Backend/, vision/ and Frontend/. It is
loaded by file path rather than by adding the root to sys.path, so nothing else
in the root folder can shadow a backend import.
"""

import importlib.util
import sys

from app.config import PROJECT_ROOT


# A distinct module name, so an unrelated installed "db" package can never be
# returned in its place.
_MODULE_NAME = "project_incident_db"


def _load_db_module():
    if _MODULE_NAME in sys.modules:
        return sys.modules[_MODULE_NAME]
    spec = importlib.util.spec_from_file_location(_MODULE_NAME, PROJECT_ROOT / "db.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[_MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


incident_db = _load_db_module()
