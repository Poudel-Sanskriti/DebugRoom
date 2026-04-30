"""Independent host watchdog: parent death or deadline kills the execution container.

Only control messages arrive over stdin. Submitted source never enters this process.
"""
import argparse
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import sys
import tempfile
import time

parser=argparse.ArgumentParser()
parser.add_argument('--container',required=True)
parser.add_argument('--scratch',required=True)
parser.add_argument('--wall-ms',type=int,required=True)
arguments=parser.parse_args()
if not arguments.container.startswith('debugroom-'):
    sys.exit('Invalid execution container')
scratch=Path(arguments.scratch).resolve()
if not scratch.name.startswith('debugroom-') or scratch.parent!=Path(tempfile.gettempdir()).resolve():
    sys.exit('Invalid execution scratch directory')
docker=[os.environ.get('DOCKER_BIN','docker')]
if os.environ.get('DOCKER_CONTEXT'):
    docker+=['--context',os.environ['DOCKER_CONTEXT']]
selector=selectors.DefaultSelector()
selector.register(sys.stdin.buffer,selectors.EVENT_READ)
deadline=time.monotonic()+30
reason=''
started=False
while True:
    remaining=deadline-time.monotonic()
    if remaining<=0:
        reason='timeout' if started else 'startup_timeout'
        break
    ready=selector.select(timeout=min(remaining,0.25))
    if not ready:
        continue
    message=sys.stdin.buffer.readline()
    if not message:
        reason='parent_exit'
        break
    message=message.strip()
    if message==b'done':
        selector.close()
        sys.exit(0)
    if message==b'started':
        started=True
        deadline=time.monotonic()+arguments.wall_ms/1000
selector.close()
try:
    (scratch/'watchdog.json').write_text(json.dumps({'reason':reason}))
except OSError:
    pass
for command in (['kill',arguments.container],['rm','-f',arguments.container]):
    try:
        subprocess.run(docker+command,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
    except (OSError,subprocess.TimeoutExpired):
        pass
if reason=='parent_exit':
    shutil.rmtree(scratch,ignore_errors=True)
