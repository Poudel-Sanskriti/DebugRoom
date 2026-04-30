import os
import subprocess
import sys
import time
import uuid
from pathlib import Path
import unittest
from supervisor import execute, control


@unittest.skipUnless(os.environ.get('DEBUGROOM_TEST_DOCKER') == '1', 'Run with DEBUGROOM_TEST_DOCKER=1 against the dedicated local container runtime')
class SandboxTests(unittest.TestCase):
    def run_code(self, code, **kwargs):
        result, metrics = execute({'language':'python','code':code,'input':{'args':[],'kwargs':{}}}, **kwargs)
        return result

    def test_real_trace_in_disposable_container(self):
        result=self.run_code('def answer():\n    return 42\n')
        self.assertEqual(result['outcome'],'completed', result)
        self.assertEqual(result['returnValue']['value'],'42')
        self.assertGreater(len(result['steps']),0)

    def test_no_network_and_no_host_secrets(self):
        result=self.run_code('import socket, os\ndef inspect():\n    assert "DEBUGROOM_RUNNER_TOKEN" not in os.environ\n    assert "DATABASE_URL" not in os.environ\n    assert not os.path.exists("/Users")\n    s=socket.socket()\n    s.settimeout(0.3)\n    try:\n        s.connect(("1.1.1.1",443))\n        return "connected"\n    except OSError:\n        return "denied"\n')
        self.assertEqual(result['outcome'],'completed', result)
        self.assertEqual(result['returnValue']['value'],'denied')

    def test_root_filesystem_is_readonly(self):
        result=self.run_code('open("/forbidden", "w").write("no")')
        self.assertEqual(result['outcome'],'runtime_error')
        self.assertIn(result['error']['type'],['OSError','PermissionError'])

    def test_wall_limit_preserves_trace_prefix(self):
        result=self.run_code('import time\ntime.sleep(30)',policy={'wallMs':200})
        self.assertEqual(result['outcome'],'timeout')
        self.assertGreater(len(result['steps']),0)
        self.assertFalse(result['complete'])

    def test_trace_and_output_limits(self):
        trace=self.run_code('while True:\n    pass',policy={'steps':20})
        self.assertEqual(trace['outcome'],'trace_limit')
        self.assertEqual(len(trace['steps']),20)
        output=self.run_code('print("x" * 10000)',policy={'outputBytes':50})
        self.assertEqual(output['outcome'],'output_limit')
        self.assertEqual(len(output['stdout']),50)

    def test_memory_limit(self):
        result=self.run_code('a=bytearray(600*1024*1024)')
        self.assertEqual(result['outcome'],'memory_limit', result)

    def test_cancel_terminates_process(self):
        result=self.run_code('import time\ntime.sleep(30)',heartbeat=lambda started:{'active':True,'cancel':started})
        self.assertEqual(result['outcome'],'stopped')

    def test_malformed_native_output_is_not_a_trace(self):
        result=self.run_code('import os\nos.write(1,b"not-json\\n")')
        self.assertEqual(result['outcome'],'infrastructure_error')

    def test_temporary_disk_limit(self):
        result=self.run_code('with open("/tmp/large", "wb") as f:\n    for _ in range(40):\n        f.write(b"x" * 1024 * 1024)')
        self.assertEqual(result['outcome'],'runtime_error')
        self.assertIn(result['error']['type'],['OSError'])

    def test_slow_control_requests_do_not_extend_execution_deadline(self):
        def slow_heartbeat(started):
            time.sleep(1)
            return {'active':True,'cancel':False}
        started=time.monotonic()
        result=self.run_code('import time\ntime.sleep(30)',policy={'wallMs':200},heartbeat=slow_heartbeat)
        self.assertEqual(result['outcome'],'timeout')
        self.assertLess(time.monotonic()-started,3)

    def test_worker_death_does_not_leave_running_code(self):
        attempt=str(uuid.uuid4())
        code="import sys;sys.path.insert(0,"+repr(str(Path(__file__).resolve().parent))+");from supervisor import execute;execute({'language':'python','code':'import time\\ntime.sleep(30)','input':{'args':[],'kwargs':{}}},attempt_id="+repr(attempt)+")"
        worker=subprocess.Popen([sys.executable,'-c',code],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        name='debugroom-'+attempt
        try:
            deadline=time.monotonic()+10
            started=False
            while time.monotonic()<deadline:
                running=control(['inspect','--format','{{.State.Running}}',name])
                if running.returncode==0 and running.stdout.strip()=='true':
                    started=True
                    break
                time.sleep(0.05)
            self.assertTrue(started,'The test execution did not start')
            worker.kill()
            worker.wait(timeout=5)
            deadline=time.monotonic()+6
            while time.monotonic()<deadline:
                running=control(['inspect','--format','{{.State.Running}}',name])
                if running.returncode!=0:
                    break
                time.sleep(0.1)
            self.assertNotEqual(control(['inspect',name]).returncode,0,'The watchdog must remove code execution after worker death')
        finally:
            if worker.poll() is None:
                worker.kill()
                worker.wait(timeout=5)
            control(['rm','-f',name])

    def test_z_no_leftover_execution_containers(self):
        result=control(['ps','-a','--filter','label=dev.debugroom.execution=true','--format','{{.Names}}'])
        self.assertEqual(result.returncode,0)
        self.assertEqual(result.stdout.strip(),'')


if __name__=='__main__':
    unittest.main()
