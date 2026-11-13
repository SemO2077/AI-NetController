"""
AI NetController — Optional Zero-Config TLS (wss://) Certificate & Context Manager
================================================================================
Generates or loads SAN-bound ECDSA P-256 TLS 1.3/1.2 server certificates for
encrypted WebSocket (`wss://`) transport on LAN/loopback, protected by Win32 NTFS
DACLs / POSIX 0600 permissions, and exports SHA-256 cert pinning fingerprints.
================================================================================
"""

from __future__ import annotations

import datetime
import ipaddress
import logging
import os
import socket
import ssl
from typing import Iterable, Optional, Tuple

try:
    from daemon_config import _restrict_file_permissions, get_config_dir
except ImportError:
    from agent.daemon_config import _restrict_file_permissions, get_config_dir

logger = logging.getLogger("AI-NetController-TLS")


def _detect_local_san_ips() -> list[str]:
    ips = {"127.0.0.1", "::1"}
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None):
            addr = info[4][0]
            if isinstance(addr, str) and "%" not in addr:
                ips.add(addr)
    except Exception:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            local_ip = s.getsockname()[0]
            if local_ip:
                ips.add(local_ip)
    except Exception:
        pass
    return sorted(ips)


def ensure_tls_certificate(
    cert_dir: Optional[str] = None,
    extra_ips: Optional[Iterable[str]] = None,
) -> Tuple[str, str, str]:
    """
    Ensures valid ECDSA P-256 cert/key PEM pair exists on disk.
    If AI_TLS_CERT and AI_TLS_KEY env vars exist, uses them directly.
    Returns (cert_path, key_path, sha256_fingerprint_hex).
    """
    env_cert = os.environ.get("AI_TLS_CERT") or os.environ.get("CST_TLS_CERT")
    env_key = os.environ.get("AI_TLS_KEY") or os.environ.get("CST_TLS_KEY")
    if env_cert and env_key and os.path.isfile(env_cert) and os.path.isfile(env_key):
        fp = compute_cert_fingerprint(env_cert)
        return env_cert, env_key, fp

    target_dir = cert_dir or get_config_dir()
    os.makedirs(target_dir, exist_ok=True)
    _restrict_file_permissions(target_dir, is_dir=True)

    cert_path = os.path.join(target_dir, "tls_cert.pem")
    key_path = os.path.join(target_dir, "tls_key.pem")

    if os.path.isfile(cert_path) and os.path.isfile(key_path):
        if _is_cert_valid_and_fresh(cert_path):
            _restrict_file_permissions(key_path, is_dir=False)
            return cert_path, key_path, compute_cert_fingerprint(cert_path)

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    private_key = ec.generate_private_key(ec.SECP256R1())
    hostname = socket.gethostname() or "ai-netcontroller-host"
    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "AI NetController"),
            x509.NameAttribute(NameOID.COMMON_NAME, hostname[:64]),
        ]
    )

    san_entries: list[x509.GeneralName] = [
        x509.DNSName("localhost"),
        x509.DNSName(hostname),
    ]
    all_ips = set(_detect_local_san_ips())
    if extra_ips:
        for ip in extra_ips:
            if isinstance(ip, str) and ip.strip():
                all_ips.add(ip.strip())

    for ip_str in sorted(all_ips):
        try:
            san_entries.append(x509.IPAddress(ipaddress.ip_address(ip_str)))
        except ValueError:
            pass

    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(private_key, hashes.SHA256())
    )

    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    with open(key_path, "wb") as kf:
        kf.write(key_pem)
    _restrict_file_permissions(key_path, is_dir=False)

    with open(cert_path, "wb") as cf:
        cf.write(cert_pem)
    _restrict_file_permissions(cert_path, is_dir=False)

    fp = cert.fingerprint(hashes.SHA256()).hex()
    logger.info(f"Generated ECDSA P-256 SAN TLS certificate ({fp[:16]}...) in {target_dir}")
    return cert_path, key_path, fp


def _is_cert_valid_and_fresh(cert_path: str) -> bool:
    try:
        from cryptography import x509

        with open(cert_path, "rb") as f:
            cert = x509.load_pem_x509_certificate(f.read())
        now = datetime.datetime.now(datetime.timezone.utc)
        exp = getattr(cert, "not_valid_after_utc", None)
        if exp is None:
            exp = cert.not_valid_after.replace(tzinfo=datetime.timezone.utc)
        return (exp - now) > datetime.timedelta(days=14)
    except Exception:
        return False


def compute_cert_fingerprint(cert_path: str) -> str:
    """Computes SHA-256 hex digest of an X.509 PEM certificate."""
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes

        with open(cert_path, "rb") as f:
            cert = x509.load_pem_x509_certificate(f.read())
        return cert.fingerprint(hashes.SHA256()).hex()
    except Exception:
        return ""


def build_server_ssl_context(
    cert_dir: Optional[str] = None,
    extra_ips: Optional[Iterable[str]] = None,
) -> Tuple[ssl.SSLContext, str]:
    """Builds hardened TLS 1.2/1.3 server SSLContext + returns SHA-256 fingerprint."""
    cert_path, key_path, fp = ensure_tls_certificate(cert_dir=cert_dir, extra_ips=extra_ips)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.options |= getattr(ssl, "OP_NO_COMPRESSION", 0)
    ctx.options |= getattr(ssl, "OP_CIPHER_SERVER_PREFERENCE", 0)
    ctx.load_cert_chain(certfile=cert_path, keyfile=key_path)
    return ctx, fp
