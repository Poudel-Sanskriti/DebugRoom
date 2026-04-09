import os
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'agent'))
from supervisor import execute

FACTORIAL='''#include <iostream>
int factorial(int n) {
    if (n <= 1) return 1;
    int smaller = factorial(n - 1);
    return n * smaller;
}
int main() {
    int n = 0;
    std::cin >> n;
    int answer = factorial(n);
    std::cout << answer << "\\n";
    return 0;
}
'''
LINKED='''#include <iostream>
struct Node { int value; Node* next; };
int main() {
    Node last{3, nullptr};
    Node middle{2, &last};
    Node first{1, &middle};
    Node* current = &first;
    int total = 0;
    while (current != nullptr) {
        total += current->value;
        current = current->next;
    }
    std::cout << total << "\\n";
    return 0;
}
'''


@unittest.skipUnless(os.environ.get('DEBUGROOM_TEST_DOCKER')=='1','Requires the dedicated C++ container image')
class CppTests(unittest.TestCase):
    def execute(self,code,stdin='',**kwargs):
        result,_=execute({'language':'cpp','code':code,'input':{'args':[],'kwargs':{},'stdin':stdin}},**kwargs)
        return result

    def test_recursion_and_structured_stdin(self):
        result=self.execute(FACTORIAL,'4\n')
        self.assertEqual(result['outcome'],'completed',result)
        self.assertEqual(result['stdout'],'24\n')
        self.assertGreaterEqual(max(len(step['frames']) for step in result['steps']),5)
        self.assertEqual(result['returnValue']['value'],'0')

    def test_linked_nodes_and_pointer_relationships(self):
        result=self.execute(LINKED)
        self.assertEqual(result['outcome'],'completed',result)
        self.assertEqual(result['stdout'],'6\n')
        linked=[step for step in result['steps'] if any(node.get('attributes',{}).get('next',{}).get('kind')=='ref' for node in step['objects'].values())]
        self.assertTrue(linked)
        self.assertTrue(any('current' in frame['locals'] and frame['locals']['current']['kind']=='ref' for step in linked for frame in step['frames']))

    def test_vector_values_are_bounded_and_visible(self):
        result=self.execute('#include <vector>\nint main() {\n    std::vector<int> numbers{1,2,3};\n    numbers.push_back(4);\n    return 0;\n}\n')
        self.assertEqual(result['outcome'],'completed',result)
        vectors=[node for step in result['steps'] for node in step['objects'].values() if node['type']=='vector']
        self.assertTrue(any(node['length']==3 for node in vectors))
        self.assertTrue(any(node['length']==4 for node in vectors))

    def test_compiler_errors_keep_original_line(self):
        result=self.execute('int main() {\n    unknown_name();\n}\n')
        self.assertEqual(result['outcome'],'compile_error')
        self.assertEqual(result['error']['line'],2)
        self.assertIn('unknown_name',result['error']['message'])

    def test_uninitialized_locals_are_unavailable(self):
        result=self.execute('int main() {\n    int uninitialized;\n    int initialized = 1;\n    return initialized;\n}\n')
        values=[frame['locals']['uninitialized'] for step in result['steps'] for frame in step['frames'] if 'uninitialized' in frame['locals']]
        self.assertTrue(values)
        self.assertTrue(all(value['kind']=='unavailable' for value in values))

    def test_timeout_and_trace_limit(self):
        result=self.execute('#include <unistd.h>\nint main() {\n    sleep(30);\n    return 0;\n}\n',policy={'wallMs':250})
        self.assertEqual(result['outcome'],'timeout',result)
        result=self.execute('int main() {\n    int n = 0;\n    while (true) {\n        n += 1;\n    }\n}\n',policy={'steps':20})
        self.assertEqual(result['outcome'],'trace_limit',result)
        self.assertEqual(len(result['steps']),20)


if __name__=='__main__':
    unittest.main()
