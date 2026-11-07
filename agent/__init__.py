"""AI NetController Agent Package."""

try:
    from agent.agent import HostAgentDaemon, pack_packet, unpack_packet
except ImportError:
    try:
        from .agent import HostAgentDaemon, pack_packet, unpack_packet
    except ImportError:
        pass

