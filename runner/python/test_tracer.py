import json
from pathlib import Path
import subprocess
import sys
import unittest

TRACER = str(Path(__file__).with_name('tracer.py'))


def run(code, args=None, **options):
    job = {'code': code, 'input': {'args': args or [], 'kwargs': {}}, **options}
    proc = subprocess.run([sys.executable, '-I', '-S', TRACER], input=json.dumps(job), text=True, capture_output=True, timeout=10)
    if proc.returncode:
        raise AssertionError(proc.stderr + proc.stdout)
    records = [json.loads(line) for line in proc.stdout.splitlines()]
    return records


def steps(records, function=None):
    events = [r['event'] for r in records if r['type'] == 'event']
    return [e for e in events if not function or e['frames'][-1]['function'] == function]


class TraceTests(unittest.TestCase):
    def test_solution_method_and_global_scope(self):
        code = 'offset = 2\nclass Solution:\n    def add(self, a, b):\n        total = a + b + offset\n        return total\n'
        records = run(code, [2, 3])
        self.assertEqual(records[-1]['returnValue']['value'], '7')
        event = next(e for e in steps(records, 'add') if e['kind'] == 'line' and e['line'] == 5)
        self.assertEqual(event['globals']['offset']['value'], '2')
        self.assertIn('self', event['frames'][-1]['locals'])
        discovery = run(code, mode='discover')[0]
        self.assertEqual(discovery['functions'][0]['name'], 'Solution.add')
        self.assertEqual(discovery['functions'][0]['signature'], 'a, b')

    def test_deque_and_metaclass_getters_are_not_evaluated(self):
        code = 'from collections import deque\nclass Meta(type):\n    @property\n    def __name__(cls):\n        raise AssertionError("metadata getter called")\nclass Node(metaclass=Meta):\n    def __init__(self):\n        self.value=3\ndef example():\n    queue=deque([1,2])\n    node=Node()\n    return [queue,node]\n'
        records=run(code)
        self.assertEqual(records[-1]['outcome'], 'completed')
        kinds=[node['type'] for node in records[-1]['objects'].values()]
        self.assertIn('deque', kinds)
        self.assertIn('Node', kinds)

    def test_private_names_and_decorated_entry_points(self):
        private=run('def _answer():\n    __value = 7\n    return __value\n')
        self.assertEqual(private[-1]['returnValue']['value'], '7')
        self.assertTrue(any('__value' in event['frames'][-1]['locals'] for event in steps(private, '_answer')))
        cached=run('from functools import lru_cache\n@lru_cache(None)\ndef fib(n):\n    if n < 2:\n        return n\n    return fib(n-1)+fib(n-2)\n', [6])
        self.assertEqual(cached[-1]['outcome'], 'completed')
        self.assertEqual(cached[-1]['returnValue']['value'], '8')

    def test_long_variable_names_remain_distinct(self):
        left='a'*205+'x'
        right='a'*205+'y'
        records=run('def example():\n    '+left+'=1\n    '+right+'=2\n    return '+left+'+'+right+'\n')
        final=steps(records,'example')[-1]['frames'][-1]['locals']
        self.assertEqual(final[left]['value'],'1')
        self.assertEqual(final[right]['value'],'2')

    def test_before_line_and_return(self):
        records = run('def add(a, b):\n    total = a + b\n    return total\n', [2, 3])
        events = steps(records, 'add')
        line2 = next(e for e in events if e['kind'] == 'line' and e['line'] == 2)
        line3 = next(e for e in events if e['kind'] == 'line' and e['line'] == 3)
        self.assertNotIn('total', line2['frames'][-1]['locals'])
        self.assertEqual(line3['frames'][-1]['locals']['total']['value'], '5')
        self.assertEqual(events[-1]['returnValue']['value'], '5')
        self.assertEqual(records[-1]['returnValue']['value'], '5')

    def test_binary_search(self):
        code = 'def search(nums, target):\n    low, high = 0, len(nums) - 1\n    while low <= high:\n        mid = (low + high) // 2\n        if nums[mid] == target:\n            return mid\n        if nums[mid] < target:\n            low = mid + 1\n        else:\n            high = mid - 1\n    return -1\n'
        records = run(code, [[1, 3, 5, 7, 9], 7])
        observations = [e['frames'][-1]['locals'] for e in steps(records, 'search') if e['kind'] == 'line' and e['line'] == 5]
        self.assertEqual([(x['low']['value'], x['high']['value'], x['mid']['value']) for x in observations], [('0','4','2'), ('3','4','3')])
        self.assertEqual(records[-1]['returnValue']['value'], '3')
        self.assertEqual(run(code, [[], 7])[-1]['returnValue']['value'], '-1')

    def test_alias_mutation_preserves_history_and_changes(self):
        records = run('def mutate():\n    a = [1]\n    b = a\n    a.append(2)\n    return b\n')
        events = steps(records, 'mutate')
        before = next(e for e in events if e['kind'] == 'line' and e['line'] == 4)
        after = next(e for e in events if e['kind'] == 'line' and e['line'] == 5)
        a = before['frames'][-1]['locals']['a']
        self.assertEqual(a, before['frames'][-1]['locals']['b'])
        self.assertEqual([x['value'] for x in before['objects'][a['id']]['items']], ['1'])
        self.assertEqual([x['value'] for x in after['objects'][a['id']]['items']], ['1','2'])
        self.assertIn('a', after['frames'][-1]['changes'])
        self.assertIn('b', after['frames'][-1]['changes'])

    def test_cycle_and_large_integer(self):
        records = run('def cycle():\n    a = []\n    a.append(a)\n    huge = 9007199254740993\n    return a\n')
        event = next(e for e in steps(records, 'cycle') if e['kind'] == 'line' and e['line'] == 5)
        a = event['frames'][-1]['locals']['a']
        self.assertEqual(event['objects'][a['id']]['items'][0], a)
        self.assertEqual(event['frames'][-1]['locals']['huge']['value'], '9007199254740993')

    def test_recursion_has_distinct_frames(self):
        records = run('def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n', [4])
        deepest = max(steps(records), key=lambda e: len(e['frames']))
        self.assertEqual(len(deepest['frames']), 4)
        self.assertEqual(len({f['id'] for f in deepest['frames']}), 4)
        self.assertEqual(records[-1]['returnValue']['value'], '24')

    def test_caught_exception_is_not_terminal_failure(self):
        records = run('def example():\n    try:\n        1 / 0\n    except ZeroDivisionError:\n        return 7\n')
        self.assertTrue(any(e['kind'] == 'exception' for e in steps(records)))
        self.assertEqual(records[-1]['outcome'], 'completed')

    def test_exception_unwinding_is_not_a_none_return(self):
        records=run('def bad():\n    try:\n        return 1 / 0\n    finally:\n        cleanup = True\n')
        exit_event=steps(records,'bad')[-1]
        self.assertTrue(exit_event['unwinding'])
        self.assertNotIn('returnValue',exit_event)
        self.assertEqual(records[-1]['outcome'],'runtime_error')

    def test_original_error_and_line(self):
        records = run('def bad():\n    return 1 / 0\n')
        self.assertEqual(records[-1]['outcome'], 'runtime_error')
        self.assertEqual(records[-1]['error']['message'], 'division by zero')
        self.assertEqual(records[-1]['error']['line'], 2)
        syntax = run('def broken(:\n')
        self.assertEqual(syntax[-1]['outcome'], 'syntax_error')
        self.assertEqual(syntax[-1]['error']['line'], 1)

    def test_output_and_stderr_separate(self):
        records = run('import sys\ndef hello():\n    print("hello")\n    print("warning", file=sys.stderr)\n')
        self.assertEqual(''.join(r['text'] for r in records if r['type'] == 'output' and r['stream'] == 'stdout'), 'hello\n')
        self.assertEqual(''.join(r['text'] for r in records if r['type'] == 'output' and r['stream'] == 'stderr'), 'warning\n')

    def test_limits_preserve_prefix(self):
        records = run('while True:\n    pass\n', limits={'steps': 12})
        self.assertEqual(len(steps(records)), 12)
        self.assertEqual(records[-1]['outcome'], 'trace_limit')
        records = run('print("x" * 1000)', limits={'outputBytes': 20})
        self.assertEqual(''.join(r['text'] for r in records if r['type'] == 'output'), 'x' * 20)
        self.assertEqual(records[-1]['outcome'], 'output_limit')

    def test_does_not_call_repr_properties_or_custom_iteration(self):
        code = 'class Node:\n    def __init__(self):\n        self.value = 5\n    def __repr__(self):\n        raise AssertionError("repr called")\n    @property\n    def surprise(self):\n        raise AssertionError("property called")\ndef example():\n    node = Node()\n    return node\n'
        records = run(code)
        self.assertEqual(records[-1]['outcome'], 'completed')
        returned = records[-1]['returnValue']
        self.assertEqual(records[-1]['objects'][returned['id']]['attributes']['value']['value'], '5')

    def test_discovery_does_not_execute_source(self):
        records = run('raise RuntimeError("do not execute")\ndef first(x):\n    return x\ndef second(y=1):\n    return y\n', mode='discover')
        self.assertEqual([f['name'] for f in records[0]['functions']], ['first','second'])

    def test_bad_arguments_and_multiple_entry_points(self):
        self.assertEqual(run('def add(a,b):\n    return a+b', [1])[-1]['outcome'], 'input_error')
        self.assertEqual(run('def a():\n    pass\ndef b():\n    pass')[-1]['outcome'], 'input_error')


if __name__ == '__main__':
    unittest.main()
