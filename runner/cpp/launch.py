"""Enter through LLDB's own Python interpreter on Ubuntu's packaged LLVM 18."""
import json
import os
import sys
from pathlib import Path
job=json.load(sys.stdin)
Path('/tmp/debugroom-job.json').write_text(json.dumps(job))
os.execv('/usr/bin/lldb-18',['lldb-18','--batch','--no-lldbinit','--source-quietly','-o','command script import /runner/cpp/tracer.py'])
