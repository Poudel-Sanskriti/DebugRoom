"""Restricted worker control client. It never receives database credentials."""
import json
import os
import re
import signal
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

from supervisor import execute, control

API = os.environ.get('DEBUGROOM_API_URL', 'http://127.0.0.1:3001').rstrip('/')
TOKEN = os.environ.get('DEBUGROOM_RUNNER_TOKEN')
MODE = os.environ.get('DEBUGROOM_EXECUTION_MODE', 'docker')
WORKER = os.environ.get('DEBUGROOM_WORKER_ID', socket.gethostname() + '-' + uuid.uuid4().hex[:8])
LANGUAGES = os.environ.get('DEBUGROOM_LANGUAGES', 'python').split(',')
STOP = False
WATCHDOG_SCOPE = os.environ.get('DEBUGROOM_WATCHDOG_SCOPE', 'host')


def request(path, body, timeout=5):
    encoded = json.dumps(body, separators=(',', ':')).encode()
    req = urllib.request.Request(API + '/internal/worker/' + path, encoded,
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN}, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def halt(signum, frame):
    global STOP
    STOP = True


def resolve_images():
    images = {}
    for language in LANGUAGES:
        if language not in ('python','cpp'):
            raise RuntimeError('Unknown worker language')
        if MODE != 'docker':
            images[language] = MODE
            continue
        key = language.upper() + '_IMAGE'
        inspected = control(['image','inspect','--format','{{.Id}}',os.environ.get(key,'debugroom-' + language + ':local')])
        image_id = inspected.stdout.strip()
        if inspected.returncode or not re.fullmatch(r'sha256:[0-9a-f]{64}',image_id):
            raise RuntimeError('Build the ' + language + ' runtime image before starting the worker')
        os.environ[key] = image_id  # Every execution now uses this exact image, not a mutable tag.
        runtime = os.environ.get(language.upper() + '_CONTAINER_RUNTIME',os.environ.get('CONTAINER_RUNTIME','runc'))
        images[language] = 'docker/' + runtime + '@' + image_id
    return images


if not TOKEN:
    sys.exit('DEBUGROOM_RUNNER_TOKEN is required')
for sig in (signal.SIGINT, signal.SIGTERM):
    signal.signal(sig, halt)
IMAGES = resolve_images()
print(json.dumps({'event':'worker_started','workerId':WORKER,'mode':MODE,'languages':LANGUAGES,'runtimes':IMAGES}), flush=True)
while not STOP:
    try:
        job = request('claim', {'workerId':WORKER,'runtime':MODE,'languages':LANGUAGES,'runtimeImages':IMAGES,'watchdogScope':WATCHDOG_SCOPE}).get('job')
        if not job:
            time.sleep(0.5)
            continue
        def heartbeat(started):
            if STOP:
                return {'active':False,'cancel':False}
            return request('heartbeat', {'attemptId':job['attemptId'],'leaseToken':job['leaseToken'],'started':started})
        draft = job['snapshot']
        supplied = json.loads(draft['input'])
        result, metrics = execute({'code':draft['code'],'input':supplied,'entryPoint':draft['entryPoint'],'language':draft['language']},
                                  heartbeat=heartbeat,mode=MODE,policy=job['limits'],attempt_id=job['attemptId'])
        uploading = threading.Event()
        def renew_upload_lease():
            while not uploading.is_set():
                try:
                    if not heartbeat(bool(metrics.get('runtimeStarted'))).get('active'):
                        return
                except Exception:
                    pass
                uploading.wait(2)
        renewal = threading.Thread(target=renew_upload_lease,daemon=True)
        renewal.start()
        try:
            for attempt in range(3):
                try:
                    request('complete', {'attemptId':job['attemptId'],'leaseToken':job['leaseToken'],'result':result,'metrics':metrics},timeout=30)
                    break
                except urllib.error.HTTPError as exc:
                    if exc.code == 409:
                        break
                    if attempt == 2:
                        raise
                    time.sleep(0.5)
        finally:
            uploading.set()
            renewal.join(timeout=6)
        print(json.dumps({'event':'run_finished','runId':job['runId'],'attempt':job['generation'],'outcome':result['outcome']}), flush=True)
    except Exception as exc:
        print(json.dumps({'event':'worker_error','type':type(exc).__name__}), flush=True)
        time.sleep(1)
