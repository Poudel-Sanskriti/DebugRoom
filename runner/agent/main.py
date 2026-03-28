"""Restricted worker control client. It never receives database credentials."""
import json
import os
import signal
import socket
import sys
import time
import urllib.error
import urllib.request
import uuid

from supervisor import execute

API = os.environ.get('DEBUGROOM_API_URL', 'http://127.0.0.1:3001').rstrip('/')
TOKEN = os.environ.get('DEBUGROOM_RUNNER_TOKEN')
MODE = os.environ.get('DEBUGROOM_EXECUTION_MODE', 'docker')
WORKER = os.environ.get('DEBUGROOM_WORKER_ID', socket.gethostname() + '-' + uuid.uuid4().hex[:8])
LANGUAGES = os.environ.get('DEBUGROOM_LANGUAGES', 'python').split(',')
STOP = False


def request(path, body):
    encoded = json.dumps(body, separators=(',', ':')).encode()
    req = urllib.request.Request(API + '/internal/worker/' + path, encoded,
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN}, method='POST')
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.load(response)


def halt(signum, frame):
    global STOP
    STOP = True


if not TOKEN:
    sys.exit('DEBUGROOM_RUNNER_TOKEN is required')
for sig in (signal.SIGINT, signal.SIGTERM):
    signal.signal(sig, halt)
print(json.dumps({'event':'worker_started','workerId':WORKER,'mode':MODE,'languages':LANGUAGES}), flush=True)
while not STOP:
    try:
        job = request('claim', {'workerId':WORKER,'runtime':MODE,'languages':LANGUAGES}).get('job')
        if not job:
            time.sleep(0.5)
            continue
        def heartbeat(started):
            if STOP:
                return {'active':False,'cancel':True}
            return request('heartbeat', {'attemptId':job['attemptId'],'leaseToken':job['leaseToken'],'started':started})
        draft=job['snapshot']
        supplied=json.loads(draft['input'])
        result,metrics=execute({'code':draft['code'],'input':supplied,'entryPoint':draft['entryPoint'],'language':draft['language']},
                               heartbeat=heartbeat,mode=MODE,policy=job['limits'],attempt_id=job['attemptId'])
        for attempt in range(3):
            try:
                request('complete', {'attemptId':job['attemptId'],'leaseToken':job['leaseToken'],'result':result,'metrics':metrics})
                break
            except urllib.error.HTTPError as exc:
                if exc.code==409:
                    break  # A new generation or cancellation owns the outcome now.
                if attempt==2:
                    raise
                time.sleep(0.5)
        print(json.dumps({'event':'run_finished','runId':job['runId'],'attempt':job['generation'],'outcome':result['outcome']}), flush=True)
    except Exception as exc:
        print(json.dumps({'event':'worker_error','type':type(exc).__name__}), flush=True)
        time.sleep(1)
