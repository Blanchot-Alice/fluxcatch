"""Fail-closed network policy for native media transfers.

The Chrome extension can observe URLs controlled by a page.  Treating those
URLs as trusted native-host inputs would turn the downloader into an SSRF
primitive.  This module keeps the policy independent from the transfer code so
every built-in HTTP client, redirect and manifest child shares the same
decision.  External-process networking stays disabled until a pinned broker
can enforce this policy for it.
"""

from __future__ import annotations

import contextvars
import ipaddress
import re
import socket
import urllib.parse
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional, Union


class NetworkPolicyError(ValueError):
    """A URL or resolved peer is outside the permitted network scope."""


Resolver = Callable[..., list[tuple[Any, ...]]]

_METADATA_HOSTNAMES = {
    "metadata",
    "metadata.aws.internal",
    "metadata.azure.internal",
    "metadata.google.internal",
    "metadata.google.internal.",
    "instance-data",
    "instance-data.ec2.internal",
}
_METADATA_ADDRESSES = {
    ipaddress.ip_address("169.254.169.254"),
    ipaddress.ip_address("100.100.100.200"),
}
_EXPLICIT_PRIVATE_NETWORKS = (
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
)
_IPV4_ALWAYS_BLOCKED_NETWORKS = (
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("192.88.99.0/24"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
)
_IPV6_ALWAYS_BLOCKED_NETWORKS = (
    ipaddress.ip_network("100::/64"),  # discard-only
    ipaddress.ip_network("2001::/23"),  # IETF protocol assignments, including Teredo/ORCHID
    ipaddress.ip_network("2001:db8::/32"),  # documentation
    ipaddress.ip_network("3fff::/20"),  # documentation
    ipaddress.ip_network("5f00::/16"),  # segment-routing SIDs, not public endpoints
    ipaddress.ip_network("fe80::/10"),  # link-local
    ipaddress.ip_network("fec0::/10"),  # deprecated site-local
    ipaddress.ip_network("ff00::/8"),  # multicast
)
_IPV6_GLOBAL_UNICAST = ipaddress.ip_network("2000::/3")
_IPV4_COMPATIBLE = ipaddress.ip_network("::/96")
_IPV4_MAPPED = ipaddress.ip_network("::ffff:0:0/96")
_NAT64_WELL_KNOWN = ipaddress.ip_network("64:ff9b::/96")
_NAT64_LOCAL = ipaddress.ip_network("64:ff9b:1::/48")
_SIX_TO_FOUR = ipaddress.ip_network("2002::/16")
_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)


def redact_url(value: Any) -> str:
    """Return only origin-level URL identity; paths may themselves be secrets."""
    text = str(value or "")
    try:
        parsed = urllib.parse.urlsplit(text)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            return "[redacted URL]"
        host = parsed.hostname
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        try:
            port = parsed.port
        except ValueError:
            port = None
        default_port = 443 if parsed.scheme.lower() == "https" else 80
        authority = host if port in {None, default_port} else f"{host}:{port}"
        path = "/…" if parsed.path not in {"", "/"} else "/"
        return urllib.parse.urlunsplit((parsed.scheme.lower(), authority, path, "", ""))
    except (TypeError, ValueError, UnicodeError):
        return "[redacted URL]"


def redact_text(value: Any) -> str:
    """Remove query strings from URLs embedded in an exception or log line."""
    return _URL_PATTERN.sub(lambda match: redact_url(match.group(0)), str(value or ""))


IPAddress = Union[ipaddress.IPv4Address, ipaddress.IPv6Address]


def _normalized_ip(value: Any) -> IPAddress:
    return ipaddress.ip_address(str(value).split("%", 1)[0])


def _is_metadata(address: IPAddress) -> bool:
    if address in _METADATA_ADDRESSES:
        return True
    if isinstance(address, ipaddress.IPv6Address):
        # fe80::a9fe:a9fe is the IPv6 spelling commonly used for the same
        # link-local metadata endpoint as 169.254.169.254.
        return address == ipaddress.ip_address("fe80::a9fe:a9fe")
    return False


def _is_explicit_private(address: IPAddress) -> bool:
    return any(address.version == network.version and address in network for network in _EXPLICIT_PRIVATE_NETWORKS)


def _embedded_ipv4(address: ipaddress.IPv6Address) -> Optional[ipaddress.IPv4Address]:
    """Extract IPv4 bits from transition forms without version-sensitive APIs.

    ``64:ff9b:1::/48`` uses the RFC 6052 /48 layout: the first two
    IPv4 octets follow the prefix, an eight-bit ``u`` field is skipped, and
    the final two octets follow it.  The remaining suffix must be zero.  It is
    deliberately not treated like a /96 prefix; doing so could classify a
    private embedded destination from attacker-controlled suffix bits.
    """
    numeric = int(address)
    if address in _IPV4_MAPPED:
        return ipaddress.IPv4Address(numeric & 0xFFFFFFFF)
    if address in _IPV4_COMPATIBLE and numeric not in {0, 1}:
        return ipaddress.IPv4Address(numeric & 0xFFFFFFFF)
    if address in _NAT64_WELL_KNOWN:
        return ipaddress.IPv4Address(numeric & 0xFFFFFFFF)
    if address in _NAT64_LOCAL:
        u_octet = (numeric >> 56) & 0xFF
        suffix = numeric & ((1 << 40) - 1)
        if u_octet != 0 or suffix != 0:
            return None
        high = (numeric >> 64) & 0xFFFF
        low = (numeric >> 40) & 0xFFFF
        return ipaddress.IPv4Address((high << 16) | low)
    if address in _SIX_TO_FOUR:
        return ipaddress.IPv4Address((numeric >> 80) & 0xFFFFFFFF)
    return None


def _ipv4_scope(address: ipaddress.IPv4Address) -> str:
    if _is_metadata(address):
        return "metadata"
    if _is_explicit_private(address):
        return "private"
    if any(address in network for network in _IPV4_ALWAYS_BLOCKED_NETWORKS):
        return "forbidden"
    return "public"


def _ip_scope(address: IPAddress) -> str:
    """Return public/private/metadata/forbidden using explicit IANA ranges."""
    if isinstance(address, ipaddress.IPv4Address):
        return _ipv4_scope(address)
    if int(address) == 0:
        return "forbidden"
    embedded = _embedded_ipv4(address)
    if embedded is not None:
        return _ipv4_scope(embedded)
    # A malformed local-use NAT64 spelling must not fall through to the
    # global IPv6 rule.  Only canonical RFC 6052 addresses are accepted.
    if address in _NAT64_LOCAL:
        return "forbidden"
    if _is_explicit_private(address):
        return "private"
    if any(address in network for network in _IPV6_ALWAYS_BLOCKED_NETWORKS):
        return "forbidden"
    if address in _IPV6_GLOBAL_UNICAST:
        return "public"
    return "forbidden"


@dataclass(frozen=True)
class AuthorizedTarget:
    url: str
    hostname: str
    port: int
    addresses: frozenset[str]


@dataclass(frozen=True)
class NetworkPolicy:
    """Public Internet by default; private/loopback only after explicit opt-in.

    Link-local, metadata, multicast, unspecified and reserved space remains
    forbidden even when private-network media is enabled.
    """

    allow_private_network_media: bool = False
    resolver: Resolver = field(default=socket.getaddrinfo, compare=False, repr=False)

    def _validate_address(self, raw: Any, *, hostname: str) -> str:
        try:
            address = _normalized_ip(raw)
        except ValueError as error:
            raise NetworkPolicyError(f"Network target {hostname} resolved to an invalid address") from error

        scope = _ip_scope(address)
        if scope == "metadata":
            raise NetworkPolicyError(f"Network target {hostname} resolves to a metadata service")
        if scope == "forbidden":
            raise NetworkPolicyError(f"Network target {hostname} resolves to a forbidden address")
        if scope == "private":
            if not self.allow_private_network_media:
                raise NetworkPolicyError(
                    f"Network target {hostname} is private; enable private-network media explicitly to continue"
                )
            return str(address)
        return str(address)

    def authorize(self, value: Any, *, purpose: str = "media") -> AuthorizedTarget:
        text = str(value or "")
        if any(ord(character) < 0x20 or ord(character) == 0x7F for character in text):
            raise NetworkPolicyError("URL contains control characters")
        try:
            parsed = urllib.parse.urlsplit(text)
            hostname = (parsed.hostname or "").rstrip(".").lower()
            port = parsed.port
        except (TypeError, ValueError, UnicodeError) as error:
            raise NetworkPolicyError("Malformed network URL") from error
        if parsed.scheme.lower() not in {"http", "https"} or not hostname or parsed.username or parsed.password:
            raise NetworkPolicyError("Only credential-free HTTP(S) URLs are accepted")
        if len(text) > 16_384:
            raise NetworkPolicyError("URL is too long")
        if "%" in hostname:
            raise NetworkPolicyError("IPv6 zone identifiers are not accepted")
        if hostname in _METADATA_HOSTNAMES or hostname.endswith(".metadata.google.internal"):
            raise NetworkPolicyError(f"Network target {hostname} is a metadata service")
        if hostname == "localhost" or hostname.endswith(".localhost") or hostname == "localhost.localdomain":
            if not self.allow_private_network_media:
                raise NetworkPolicyError(
                    "Network target localhost is private; enable private-network media explicitly to continue"
                )
        port = port or (443 if parsed.scheme.lower() == "https" else 80)
        try:
            records = self.resolver(hostname, port, type=socket.SOCK_STREAM)
        except (OSError, UnicodeError, ValueError) as error:
            raise NetworkPolicyError(f"Could not resolve network target {hostname}") from error
        addresses: set[str] = set()
        for record in records:
            try:
                sockaddr = record[4]
                raw_address = sockaddr[0]
            except (IndexError, TypeError) as error:
                raise NetworkPolicyError(f"Resolver returned an invalid address for {hostname}") from error
            addresses.add(self._validate_address(raw_address, hostname=hostname))
        if not addresses:
            raise NetworkPolicyError(f"Network target {hostname} resolved to no addresses")
        return AuthorizedTarget(text, hostname, port, frozenset(addresses))

    def authorize_many(self, values: Iterable[Any], *, purpose: str = "manifest child") -> None:
        for value in values:
            self.authorize(value, purpose=purpose)

    def validate_peer(self, raw_address: Any, target: AuthorizedTarget) -> None:
        """Reject DNS rebinding and validate the address the socket reached."""
        address = self._validate_address(raw_address, hostname=target.hostname)
        if address not in target.addresses:
            raise NetworkPolicyError(f"Network target {target.hostname} changed address during connection")


_CURRENT_POLICY: contextvars.ContextVar[NetworkPolicy] = contextvars.ContextVar(
    "fluxcatch_network_policy",
    default=NetworkPolicy(),
)


def current_network_policy() -> NetworkPolicy:
    return _CURRENT_POLICY.get()


def set_current_network_policy(policy: NetworkPolicy) -> contextvars.Token[NetworkPolicy]:
    return _CURRENT_POLICY.set(policy)


def reset_current_network_policy(token: contextvars.Token[NetworkPolicy]) -> None:
    _CURRENT_POLICY.reset(token)
