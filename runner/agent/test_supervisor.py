import os
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

    def test_z_no_leftover_execution_containers(self):
        result=control(['ps','-a','--filter','label=dev.debugroom.execution=true','--format','{{.Names}}'])
        self.assertEqual(result.returncode,0)
        self.assertEqual(result.stdout.strip(),'')


if __name__=='__main__':
    unittest.main()
