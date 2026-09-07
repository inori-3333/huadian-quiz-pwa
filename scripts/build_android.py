#!/usr/bin/env python3
"""Build and sign the Android release using the installed JDK and Android SDK."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def run(*args, **kwargs):
    subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    signing = Path.home() / ".android/huadian-quiz"
    parser.add_argument("--keystore", type=Path, default=signing / "debug.keystore")
    parser.add_argument("--password-file", type=Path, default=signing / "legacy-debug-password")
    parser.add_argument("--alias", default="androiddebugkey")
    parser.add_argument("--previous-apk", type=Path, help="Reject a signing key that cannot update this APK")
    parser.add_argument("--check-signing", action="store_true", help="Check signing compatibility without building")
    args = parser.parse_args()
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "Library/Android/sdk"))
    java = Path(os.environ.get("JAVA_HOME", "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"))
    env = dict(os.environ, JAVA_HOME=str(java), ANDROID_HOME=str(sdk))
    env["PATH"] = str(java / "bin") + os.pathsep + env["PATH"]
    build_tools = sdk / "build-tools/34.0.0"
    if not (java / "bin/java").is_file() or not (build_tools / "apksigner").is_file():
        raise SystemExit("Install JDK 17 and Android SDK build-tools;34.0.0 first (see README).")
    keystore, password_file = args.keystore.resolve(), args.password_file.resolve()
    if not keystore.is_file() or not password_file.is_file():
        raise SystemExit("Original signing key/password missing. Restore them or pass --keystore, --password-file and --alias; a new key cannot update an existing installation.")
    certificate = subprocess.check_output([
        str(java / "bin/keytool"), "-exportcert", "-keystore", str(keystore),
        "-storepass:file", str(password_file), "-alias", args.alias,
    ], env=env)
    fingerprint = hashlib.sha256(certificate).hexdigest()
    expected = (ROOT / "android-app/signing-certificate.sha256").read_text().strip()
    if fingerprint != expected:
        raise SystemExit("Signing certificate does not match the original published app. Build stopped to prevent an incompatible APK.")
    if args.previous_apk:
        previous = subprocess.check_output([
            str(build_tools / "apksigner"), "verify", "--print-certs", str(args.previous_apk.resolve()),
        ], env=env, text=True)
        fingerprints = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)", previous)
        if fingerprints != [fingerprint]:
            raise SystemExit("Signing certificate differs from the previous APK. Build stopped: restore the original signing key to support an in-place update.")
    print(f"Signing certificate SHA-256: {fingerprint}", flush=True)
    if args.check_signing:
        return
    version = json.loads((ROOT / "package.json").read_text())["version"]
    run("python3", ROOT / "scripts/embed_banks.py", env=env)
    run("npm", "test", env=env)
    run(ROOT / "android-app/gradlew", "-p", ROOT / "android-app", "--no-daemon", "assembleRelease", "lintRelease", env=env)

    output = ROOT / "outputs/android"
    output.mkdir(parents=True, exist_ok=True)
    apk = output / f"huadian-quiz-{version}.apk"
    run(build_tools / "apksigner", "sign", "--ks", keystore,
        "--ks-key-alias", args.alias, "--ks-pass", f"file:{password_file}",
        "--out", apk,
        ROOT / "android-app/app/build/outputs/apk/release/app-release-unsigned.apk", env=env)
    run(build_tools / "apksigner", "verify", "--verbose", apk, env=env)
    run(build_tools / "zipalign", "-c", "-v", "4", apk, env=env)
    run("python3", ROOT / "tests/verify_clean_apk.py", apk, env=env)
    print(f"APK ready: {apk}")


if __name__ == "__main__":
    main()
