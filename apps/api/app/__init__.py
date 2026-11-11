"""Render service for the yuemi Markdown document studio.

Exposes a stateless HTTP API: the client sends a whole project, the service
returns rendered PDF bytes. The service never reads or writes the user's disk.
"""

# The native library paths have to be set up before WeasyPrint is imported
# anywhere, so this happens as the package is loaded.
from app import native  # noqa: F401  (registers native library directories)

__version__ = "0.1.0"
