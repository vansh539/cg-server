"""
License validation module — embedded in the tool.
Validates license.lic against the hardcoded public key.
"""

import sys, json, base64, hashlib, platform, subprocess
from datetime import datetime
from pathlib import Path

# ── Public key (RSA 2048) — private key stays with you, never ships ──────────
PUBLIC_KEY_PEM = b"""-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnlEzPwz355fyu4c0mlOX
Iznuqv6BZWYvm+DVhSoM6Nh027aGG9ZsZ2vSr365xMMzvnYtbM69uJ66UOweYExT
rEJ1D5MvQqaT6hj2o7bAUinzG8R+t+hO0m+siTiXCSy4dtoU5x1YkvqFGB/x2zBh
ydYCEcwLtvm8LQCXqz22ddE9Jzy/wJdYumjN69AWR0qinIcnwF9kSyFpt59oXaJD
2b3x9O8tOyMq0Dw87Y8CdoSaFFmN7IZAo7BFgUNJN/itbCheH2iKOjrxCg1A/4P+
EdMcU6Q7aAxXfxpVhqbuVbmd8n2p7GELzEUsVR4y7/CqyfhOTUD0lJEdBuxS8Kzk
OQIDAQAB
-----END PUBLIC KEY-----"""

PRODUCT_ID = "CapitalGainsExtractor"


def get_machine_id() -> str:
    """Generate a stable hardware fingerprint for this machine."""
    parts = []

    if platform.system() == "Windows":
        for cmd in [
            ["wmic", "csproduct", "get", "uuid"],
            ["wmic", "baseboard", "get", "serialnumber"],
        ]:
            try:
                out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True)
                val = [l.strip() for l in out.strip().splitlines() if l.strip() and l.strip().lower() not in ("uuid", "serialnumber", "")]
                if val:
                    parts.append(val[0])
            except Exception:
                pass
    elif platform.system() == "Darwin":
        try:
            out = subprocess.check_output(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                stderr=subprocess.DEVNULL, text=True
            )
            import re
            m = re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', out)
            if m:
                parts.append(m.group(1))
        except Exception:
            pass
    else:
        try:
            with open("/etc/machine-id") as f:
                parts.append(f.read().strip())
        except Exception:
            pass

    if not parts:
        # Last resort: hostname + username combo
        import socket, os
        parts.append(socket.gethostname() + os.getlogin())

    raw = "|".join(parts)
    return hashlib.sha256(raw.encode()).hexdigest()[:24].upper()


def validate_license(license_dir: Path = None) -> dict:
    """
    Validate license.lic. Returns dict with keys:
      ok (bool), client_name (str), expiry (str), days_left (int), error (str)
    """
    if license_dir is None:
        license_dir = Path(__file__).parent

    lic_path = license_dir / "license.lic"
    if not lic_path.exists():
        return {"ok": False, "error": "license.lic not found in tool folder.\nContact your provider to get a license file."}

    # Load and parse
    try:
        lic_data = json.loads(lic_path.read_text())
        payload_bytes = base64.b64decode(lic_data["payload"])
        sig_bytes     = base64.b64decode(lic_data["signature"])
        payload       = json.loads(payload_bytes)
    except Exception as e:
        return {"ok": False, "error": f"License file is corrupted or invalid.\n({e})"}

    # Verify RSA signature
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        pub_key = serialization.load_pem_public_key(PUBLIC_KEY_PEM)
        pub_key.verify(sig_bytes, payload_bytes, padding.PKCS1v15(), hashes.SHA256())
    except Exception:
        return {"ok": False, "error": "License signature is invalid.\nThis license file may have been tampered with."}

    # Check product
    if payload.get("product") != PRODUCT_ID:
        return {"ok": False, "error": "This license is for a different product."}

    # Check machine ID
    machine_id = get_machine_id()
    if payload.get("machine_id") != machine_id:
        return {
            "ok": False,
            "error": (
                f"This license is locked to a different machine.\n"
                f"Your Machine ID: {machine_id}\n"
                f"Send this ID to your provider to get a new license."
            )
        }

    # Check expiry
    try:
        expiry = datetime.fromisoformat(payload["expiry"])
    except Exception:
        return {"ok": False, "error": "License expiry date is unreadable."}

    now = datetime.now()
    days_left = (expiry - now).days

    if now > expiry:
        return {
            "ok": False,
            "error": (
                f"Your license expired on {expiry.strftime('%d %B %Y')}.\n"
                f"Please contact your provider to renew."
            ),
            "expired": True,
            "client_name": payload.get("client_name", ""),
        }

    return {
        "ok": True,
        "client_name": payload.get("client_name", ""),
        "expiry": expiry.strftime("%d %B %Y"),
        "days_left": days_left,
        "error": None,
    }


def check_and_exit_if_invalid(license_dir: Path = None):
    """Call this at startup. Prints machine ID if no license, exits if invalid."""
    result = validate_license(license_dir)

    if not result["ok"]:
        machine_id = get_machine_id()
        print("\n" + "=" * 55, file=sys.stderr)
        print("  LICENSE ERROR", file=sys.stderr)
        print("=" * 55, file=sys.stderr)
        print(result["error"], file=sys.stderr)
        print(f"\nYour Machine ID: {machine_id}", file=sys.stderr)
        print("=" * 55 + "\n", file=sys.stderr)
        sys.exit(1)

    # Warn if expiring soon
    if result["days_left"] <= 30:
        print(
            f"[LICENSE] WARNING: Your license expires in {result['days_left']} days "
            f"({result['expiry']}). Contact your provider to renew.",
            file=sys.stderr
        )

    return result
