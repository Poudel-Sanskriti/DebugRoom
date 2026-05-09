import type { Draft } from "@debugroom/contracts";
export type Example = { id: string; title: string; draft: Draft };
export const examples: Example[] = [
  {
    id: "bubble-sort",
    title: "Watch a bubble sort",
    draft: {
      language: "python",
      entryPoint: "bubble_sort",
      problem:
        "Sort the list in ascending order. Follow j as neighboring values swap places. Each line shows the state before it executes.",
      input: '{\n  "args": [[5, 2, 4, 1, 3]],\n  "kwargs": {}\n}',
      code: "def bubble_sort(nums):\n    for end in range(len(nums) - 1, 0, -1):\n        for j in range(end):\n            if nums[j] > nums[j + 1]:\n                nums[j], nums[j + 1] = nums[j + 1], nums[j]\n    return nums\n",
    },
  },
  {
    id: "binary-search",
    title: "Binary search",
    draft: {
      language: "python",
      entryPoint: "binary_search",
      problem:
        "Find the index of target in a sorted list. Return -1 if it is absent.\n\nWatch how low, high, and mid narrow the search.",
      input: '{\n  "args": [[1, 3, 5, 7, 9, 11, 13], 11],\n  "kwargs": {}\n}',
      code: "def binary_search(nums, target):\n    low, high = 0, len(nums) - 1\n\n    while low <= high:\n        mid = (low + high) // 2\n        if nums[mid] == target:\n            return mid\n        if nums[mid] < target:\n            low = mid + 1\n        else:\n            high = mid - 1\n\n    return -1\n",
    },
  },
  {
    id: "loop",
    title: "A running total",
    draft: {
      language: "python",
      entryPoint: "running_total",
      problem:
        "Add the values in a list. Inspect total before and after each loop iteration.",
      input: '{\n  "args": [[2, 4, 6]],\n  "kwargs": {}\n}',
      code: 'def running_total(numbers):\n    total = 0\n    for number in numbers:\n        total += number\n        print("total:", total)\n    return total\n',
    },
  },
  {
    id: "recursion",
    title: "Recursive factorial",
    draft: {
      language: "python",
      entryPoint: "factorial",
      problem:
        "Calculate n! recursively. Expand the call stack to inspect each invocation.",
      input: '{\n  "args": [4],\n  "kwargs": {}\n}',
      code: "def factorial(n):\n    if n <= 1:\n        return 1\n    smaller = factorial(n - 1)\n    return n * smaller\n",
    },
  },
  {
    id: "alias",
    title: "Lists, aliases & mutation",
    draft: {
      language: "python",
      entryPoint: "inspect_aliases",
      problem:
        "Two names can refer to the same list. Follow their object IDs, then move backward after the mutation.",
      input: '{\n  "args": [],\n  "kwargs": {}\n}',
      code: 'def inspect_aliases():\n    first = [1, 2]\n    second = first\n    first.append(3)\n    return {"first": first, "second": second}\n',
    },
  },
  {
    id: "tree",
    title: "A small binary tree",
    draft: {
      language: "python",
      entryPoint: "tree_total",
      problem: "Inspect a tree and follow recursive calls that add its values.",
      input: '{\n  "args": [],\n  "kwargs": {}\n}',
      code: "class Node:\n    def __init__(self, value, left=None, right=None):\n        self.value = value\n        self.left = left\n        self.right = right\n\ndef tree_total():\n    root = Node(4, Node(2), Node(6))\n    def total(node):\n        if node is None:\n            return 0\n        return node.value + total(node.left) + total(node.right)\n    return total(root)\n",
    },
  },
  {
    id: "error",
    title: "Inspect a Python error",
    draft: {
      language: "python",
      entryPoint: "divide",
      problem:
        "Run with a zero denominator to inspect the original Python error and the state that led to it.",
      input: '{\n  "args": [10, 0],\n  "kwargs": {}\n}',
      code: "def divide(numerator, denominator):\n    quotient = numerator / denominator\n    return quotient\n",
    },
  },
];

examples.push(
  {
    id: "cpp-recursion",
    title: "C++ · Recursive factorial",
    draft: {
      language: "cpp",
      entryPoint: null,
      problem:
        "Compute a factorial with a recursive C++ function. main() reads n from stdin and prints the answer. The return value shown for a C++ run is the process exit code.",
      input: '{\n  "args": [],\n  "kwargs": {},\n  "stdin": "4\\n"\n}',
      code: '#include <iostream>\n\nint factorial(int n) {\n    if (n <= 1) return 1;\n    int smaller = factorial(n - 1);\n    return n * smaller;\n}\n\nint main() {\n    int n = 0;\n    std::cin >> n;\n    int answer = factorial(n);\n    std::cout << answer << "\\n";\n    return 0;\n}\n',
    },
  },
  {
    id: "cpp-linked-list",
    title: "C++ · Linked nodes & pointers",
    draft: {
      language: "cpp",
      entryPoint: null,
      problem:
        "Follow next pointers through three nodes and add their values. Locals use explicit initializers so their observed values can be shown reliably.",
      input: '{\n  "args": [],\n  "kwargs": {},\n  "stdin": ""\n}',
      code: '#include <iostream>\n\nstruct Node { int value; Node* next; };\n\nint main() {\n    Node last{3, nullptr};\n    Node middle{2, &last};\n    Node first{1, &middle};\n    Node* current = &first;\n    int total = 0;\n\n    while (current != nullptr) {\n        total += current->value;\n        current = current->next;\n    }\n    std::cout << total << "\\n";\n    return 0;\n}\n',
    },
  },
  {
    id: "cpp-vector",
    title: "C++ · Vector mutation",
    draft: {
      language: "cpp",
      entryPoint: null,
      problem:
        "Inspect a vector before and after push_back and an element update. Historical observations remain unchanged.",
      input: '{\n  "args": [],\n  "kwargs": {},\n  "stdin": ""\n}',
      code: '#include <iostream>\n#include <vector>\n\nint main() {\n    std::vector<int> numbers{1, 2, 3};\n    numbers.push_back(4);\n    numbers[0] = 10;\n    std::cout << numbers.size() << "\\n";\n    return 0;\n}\n',
    },
  },
);
