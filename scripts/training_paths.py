"""Resolve the prepared dataset without binding experiments to one Mac."""
import os,subprocess
from pathlib import Path

def cache_root(root):
    if os.environ.get('FLY_CACHE_ROOT'):
        return Path(os.environ['FLY_CACHE_ROOT']).expanduser().resolve()
    common=Path(subprocess.check_output(['git','rev-parse','--git-common-dir'],cwd=root,text=True).strip())
    if not common.is_absolute():common=root/common
    return common.resolve().parent/'.cache'
