"""AI NetController Agent Package."""

import logging

__all__ = ["JOB_SUPERVISOR", "HostAgentDaemon", "pack_packet", "unpack_packet"]

_logger = logging.getLogger("AI_NetController.agent")

try:
    from agent.agent import JOB_SUPERVISOR, HostAgentDaemon, pack_packet, unpack_packet
except ImportError:
    try:
        from .agent import JOB_SUPERVISOR, HostAgentDaemon, pack_packet, unpack_packet
    except ImportError as exc:
        import importlib.util
        import os
        import sys

        _loaded = False
        _search_dirs = [os.path.dirname(os.path.abspath(__file__))]
        if hasattr(sys, "_MEIPASS"):
            _search_dirs.extend([sys._MEIPASS, os.path.join(sys._MEIPASS, "agent")])
        if getattr(sys, "frozen", False):
            _exe_dir = os.path.dirname(os.path.abspath(sys.executable))
            _search_dirs.extend([_exe_dir, os.path.join(_exe_dir, "_internal"), os.path.join(_exe_dir, "_internal", "agent")])
        for _d in _search_dirs:
            _cand = os.path.join(_d, "agent.py")
            if os.path.isfile(_cand):
                try:
                    _spec = importlib.util.spec_from_file_location("agent.agent", _cand)
                    if _spec and _spec.loader:
                        _mod = importlib.util.module_from_spec(_spec)
                        sys.modules["agent.agent"] = _mod
                        _spec.loader.exec_module(_mod)
                        JOB_SUPERVISOR = getattr(_mod, "JOB_SUPERVISOR", None)
                        HostAgentDaemon = _mod.HostAgentDaemon
                        pack_packet = _mod.pack_packet
                        unpack_packet = _mod.unpack_packet
                        _loaded = True
                        break
                except Exception:
                    pass
        if not _loaded:
            _logger.debug("Agent package deferred import: %s", exc)

