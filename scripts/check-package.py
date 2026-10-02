"""Fail on accidental private artifacts in tracked release files."""
from pathlib import Path
import re, subprocess, sys
root=Path(__file__).resolve().parent.parent
r=subprocess.run(['git','ls-files','-z'],cwd=root,capture_output=True)
names=r.stdout.decode().split('\0') if r.returncode==0 else []
if not any(names):
    names=[str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and not any(x in p.relative_to(root).parts for x in ['.git','upstream','node_modules','__pycache__'])]
errors=[]
for name in filter(None,names):
    p=root/name
    if any(x in Path(name).parts for x in ['node_modules','upstream','backups','__pycache__']) or name.endswith(('.env','.jsonl','.log','.pyc')):
        errors.append(name+': private/generated artifact')
    s=p.read_text(errors='replace')
    if re.search(r'(?:sk-or-v1-|sk-proj-|gh[pousr]_)[A-Za-z0-9_-]{20,}',s):
        errors.append(name+': credential pattern')
    if re.search(r'/'+'Users'+r'/[^/\s]+/',s):
        errors.append(name+': personal absolute path')
    if '-----BEGIN '+'PRIVATE KEY-----' in s:
        errors.append(name+': private key')
if errors:
    print('\n'.join(errors));sys.exit(1)
print('Release file checks passed (heuristic; not a comprehensive secret audit).')
