"""Exercise the real portable signer with disposable test keys, never owner secrets."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--apk', required=True)
parser.add_argument('--apksigner', required=True)
args = parser.parse_args()
script = Path(__file__).with_name('sign-fresh-attendance.sh')
with tempfile.TemporaryDirectory(prefix='attendance-sign-test-') as directory:
    root = Path(directory)
    bundle, private, output = root / 'bundle', root / 'private', root / 'output'
    bundle.mkdir()
    shutil.copyfile(args.apk, bundle / 'attendance-1.11-unsigned.apk')
    shutil.copyfile(args.apksigner, bundle / 'apksigner.jar')
    shutil.copyfile(script, bundle / script.name)
    (bundle / 'unsigned.sha256').write_text(hashlib.sha256(Path(args.apk).read_bytes()).hexdigest() + '\n')
    pin = bundle / 'signing-certificate.sha256'
    pin.write_text('UNCONFIGURED\n')
    env = {**os.environ, 'SHIKSHAVERTEX_SIGNING_DIR': str(private), 'SHIKSHAVERTEX_APK_DIR': str(output)}
    def run(password_input):
        return subprocess.run(['bash', str(bundle / script.name)], input=password_input, text=True, capture_output=True, env=env)
    # A bad payload must be rejected before asking for or creating a private key.
    checksum = (bundle / 'unsigned.sha256').read_text()
    (bundle / 'unsigned.sha256').write_text('0' * 64)
    bad = run('')
    assert bad.returncode != 0 and 'checksum mismatch' in bad.stderr and not private.exists()
    (bundle / 'unsigned.sha256').write_text(checksum)
    password = 'disposable-integration-password'
    first = run(password + '\n' + password + '\n')
    assert first.returncode == 0, first.stderr
    assert password not in first.stdout + first.stderr
    key = private / 'attendance-release.p12'
    original_key = key.read_bytes()
    cert = re.search(r'Public SHA256: ([0-9A-F]{64})', first.stdout).group(1)
    assert (output / 'attendance-1.11.apk').is_file()
    assert not any(output.glob('*.p12')) and not any(bundle.glob('*.p12'))
    assert (key.stat().st_mode & 0o077) == 0
    verification = subprocess.run(['java', '-jar', str(bundle / 'apksigner.jar'), 'verify', '--print-certs', str(output / 'attendance-1.11.apk')], capture_output=True, text=True, check=True)
    assert cert.lower() in verification.stdout
    # Later builds must reuse the same key and pass the pinned certificate guard.
    pin.write_text(cert + '\n')
    second = run(password + '\n')
    assert second.returncode == 0, second.stderr
    assert key.read_bytes() == original_key
    assert re.search(r'Public SHA256: ([0-9A-F]{64})', second.stdout).group(1) == cert
    assert password not in second.stdout + second.stderr
    # A configured identity is never regenerated when its key is missing.
    other_env = {**env, 'SHIKSHAVERTEX_SIGNING_DIR': str(root / 'missing-key')}
    absent = subprocess.run(['bash', str(bundle / script.name)], input='', text=True, capture_output=True, env=other_env)
    assert absent.returncode != 0 and 'will not replace' in absent.stderr
    # A mismatched existing key must not publish an APK or replace that key.
    (output / 'attendance-1.11.apk').unlink()
    pin.write_text('0' * 64)
    mismatch = run(password + '\n')
    assert mismatch.returncode != 0 and 'does not match' in mismatch.stderr
    assert not (output / 'attendance-1.11.apk').exists() and key.read_bytes() == original_key
print('Portable signing tests passed: payload checksum, new-key creation/signature, private-file separation/permissions, password non-disclosure, stable reuse, pinned mismatch and missing-key guards. Only disposable keys used.')
