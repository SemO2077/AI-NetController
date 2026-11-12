"""AI NetController Agent Package."""

import logging

_logger = logging.getLogger("AI_NetController.agent")

try:
    from agent.agent import JOB_SUPERVISOR, HostAgentDaemon, pack_packet, unpack_packet
except ImportError:
    try:
        from .agent import JOB_SUPERVISOR, HostAgentDaemon, pack_packet, unpack_packet
    except ImportError as exc:
        _logger.debug("Agent package deferred import: %s", exc)

