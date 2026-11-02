"""Render service for the YueMi Markdown document studio.

Exposes a stateless HTTP API: the client sends a whole project, the service
returns rendered PDF bytes. The service never reads or writes the user's disk.
"""

__version__ = "0.1.0"
