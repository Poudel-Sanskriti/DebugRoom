import type { PracticeProblem } from "./types";

// Keep the same adapter in both modes; only the algorithm body changes.
function program(method: string, body: string, helpers = "", wrapper = "") {
  const prefix = `${helpers}class Solution:\n    def ${method}:\n`;
  return {
    solution: `${prefix}${body}\n${wrapper}`,
    starter: `${prefix}        raise NotImplementedError("Implement this method")\n${wrapper}`,
  };
}

const listHelpers = `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next


def build_list(values):
    head = None
    tail = None
    for value in values:
        node = ListNode(value)
        if head is None:
            head = node
        else:
            tail.next = node
        tail = node
    return head


def list_values(head):
    values = []
    while head is not None:
        values.append(head.val)
        head = head.next
    return values


`;

const treeHelpers = `class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


def build_tree(values):
    if not values or values[0] is None:
        return None
    root = TreeNode(values[0])
    queue = [root]
    index = 1
    for node in queue:
        if index >= len(values):
            break
        if values[index] is not None:
            node.left = TreeNode(values[index])
            queue.append(node.left)
        index += 1
        if index < len(values) and values[index] is not None:
            node.right = TreeNode(values[index])
            queue.append(node.right)
        index += 1
    return root


def tree_values(root):
    if root is None:
        return []
    values = []
    queue = [root]
    for node in queue:
        if node is None:
            values.append(None)
        else:
            values.append(node.val)
            queue.extend([node.left, node.right])
    while values and values[-1] is None:
        values.pop()
    return values


`;

export const structureProblems: PracticeProblem[] = [
  {
    id: "valid-parentheses",
    number: 20,
    title: "Valid Parentheses",
    pattern: "Stack",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/valid-parentheses/",
    summary:
      "Decide whether every closing bracket matches the most recent unmatched opening bracket. The input contains only (), [] and {}.",
    constraints: [
      "1 ≤ s.length ≤ 10,000",
      "s contains only bracket characters.",
    ],
    hints: [
      "The last bracket opened must be the first one closed.",
      "Push opening brackets; compare each closing bracket with the top of the stack.",
      "A valid string must leave the stack empty.",
    ],
    time: "O(n)",
    space: "O(n)",
    watch:
      "Follow stack as opening brackets arrive and matching closers pop them. A mismatch or an empty stack at a closer returns false immediately.",
    entryPoint: "Solution.isValid",
    ...program(
      "isValid(self, s)",
      `        stack = []
        pairs = {')': '(', ']': '[', '}': '{'}
        for i, char in enumerate(s):
            if char in pairs:
                if not stack or stack[-1] != pairs[char]:
                    return False
                stack.pop()
            else:
                stack.append(char)
        return len(stack) == 0
`,
    ),
    cases: [
      { name: "Nested pairs", args: ["([]){}"], expected: true },
      { name: "Crossed pairs", args: ["([)]"], expected: false },
      { name: "Unclosed opener", args: ["(("], expected: false },
      { name: "Unexpected closer", args: ["]"], expected: false },
    ],
  },
  {
    id: "valid-palindrome",
    number: 125,
    title: "Valid Palindrome",
    pattern: "Two pointers",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/valid-palindrome/",
    summary:
      "Ignore punctuation and letter case, then check whether a string reads identically in both directions. This teaching solution first builds a lowercase alphanumeric character array so both pointers are visible.",
    constraints: [
      "1 ≤ s.length ≤ 200,000",
      "s contains printable ASCII characters.",
    ],
    hints: [
      "Normalize case and retain only letters and digits.",
      "Compare the outermost remaining characters, then move both pointers inward.",
      "An empty normalized string is a palindrome.",
    ],
    time: "O(n)",
    space: "O(n) for the visible normalized character array",
    watch:
      "Select chars to watch left and right meet in the middle. They index the cleaned character array, not the original string. This visible version trades O(n) space for simpler animation.",
    entryPoint: "Solution.isPalindrome",
    ...program(
      "isPalindrome(self, s)",
      `        chars = list(filter(str.isalnum, s.lower()))
        left = 0
        right = len(chars) - 1
        while left < right:
            if chars[left] != chars[right]:
                return False
            left += 1
            right -= 1
        return True
`,
    ),
    cases: [
      {
        name: "Ignore punctuation",
        args: ["A man, a plan, a canal: Panama"],
        expected: true,
      },
      { name: "Mismatch", args: ["race a car"], expected: false },
      { name: "Only punctuation", args: ["., "], expected: true },
      { name: "Digits count", args: ["0P"], expected: false },
    ],
  },
  {
    id: "valid-anagram",
    number: 242,
    title: "Valid Anagram",
    pattern: "Frequency map",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/valid-anagram/",
    summary:
      "Determine whether two lowercase strings contain exactly the same letters with the same frequencies, regardless of order.",
    constraints: [
      "1 ≤ s.length, t.length ≤ 50,000",
      "Both strings contain lowercase English letters.",
    ],
    hints: [
      "Different lengths cannot be anagrams.",
      "Count letters in the first string, then spend those counts while scanning the second.",
      "A letter with no remaining count proves a mismatch.",
    ],
    time: "O(n + m)",
    space: "O(1), at most 26 letter counts",
    watch:
      "Watch counts grow for s, then shrink for t. Repeated letters need matching quantities; the final dictionary contains only zero counts for an anagram.",
    entryPoint: "Solution.isAnagram",
    ...program(
      "isAnagram(self, s, t)",
      `        if len(s) != len(t):
            return False
        counts = {}
        for char in s:
            counts[char] = counts.get(char, 0) + 1
        for char in t:
            if counts.get(char, 0) == 0:
                return False
            counts[char] -= 1
        return True
`,
    ),
    cases: [
      {
        name: "Same letter counts",
        args: ["anagram", "nagaram"],
        expected: true,
      },
      { name: "Different letters", args: ["rat", "car"], expected: false },
      { name: "Different frequencies", args: ["aab", "abb"], expected: false },
      { name: "Different lengths", args: ["a", "aa"], expected: false },
    ],
  },
  {
    id: "reverse-linked-list",
    number: 206,
    title: "Reverse Linked List",
    pattern: "Linked list pointers",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/reverse-linked-list/",
    summary:
      "Reverse a singly linked list by rewiring its next pointers. DebugRoom's run(values) adapter builds real ListNode objects from a JSON array and serializes the returned list; LeetCode supplies the head directly.",
    constraints: ["0 ≤ node count ≤ 5,000", "−5,000 ≤ node.val ≤ 5,000"],
    hints: [
      "Keep the already reversed prefix separate from the unvisited suffix.",
      "Save curr.next before changing it, so you do not lose the remaining list.",
      "Move prev and curr forward; prev becomes the new head.",
    ],
    time: "O(n) for the algorithm",
    space: "O(1) for the algorithm; O(n) for the input/output adapter",
    watch:
      "In reverseList, watch curr.next turn toward prev while next_node protects the remaining suffix. The helper frames before and after the method construct and serialize the list.",
    entryPoint: "run",
    ...program(
      "reverseList(self, head)",
      `        prev = None
        curr = head
        while curr is not None:
            next_node = curr.next
            curr.next = prev
            prev = curr
            curr = next_node
        return prev
`,
      listHelpers,
      `
def run(values):
    head = build_list(values)
    result = Solution().reverseList(head)
    return list_values(result)
`,
    ),
    cases: [
      {
        name: "Reverse four nodes",
        args: [[1, 2, 3, 4]],
        expected: [4, 3, 2, 1],
      },
      { name: "Empty list", args: [[]], expected: [] },
      { name: "Single node", args: [[7]], expected: [7] },
      { name: "Repeated values", args: [[2, 2, 1]], expected: [1, 2, 2] },
    ],
  },
  {
    id: "merge-two-sorted-lists",
    number: 21,
    title: "Merge Two Sorted Lists",
    pattern: "Linked list pointers",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/merge-two-sorted-lists/",
    summary:
      "Splice two sorted linked lists into one sorted chain. The run(values1, values2) adapter builds actual ListNode chains from JSON arrays and returns an array; LeetCode supplies and expects node references.",
    constraints: [
      "0 ≤ each list's node count ≤ 50",
      "−100 ≤ node.val ≤ 100",
      "Both input lists are sorted in nondecreasing order.",
    ],
    hints: [
      "A dummy head removes the special case of choosing the first result node.",
      "Attach the smaller current node to tail and advance that input pointer.",
      "When one list is exhausted, attach the entire remaining suffix.",
    ],
    time: "O(n + m) for the algorithm",
    space: "O(1) for the algorithm; O(n + m) for the adapter",
    watch:
      "Inside mergeTwoLists, follow list1 and list2 as tail extends the merged chain. The algorithm reuses existing nodes; dummy is only a starting anchor. Helpers translate JSON arrays to and from nodes.",
    entryPoint: "run",
    ...program(
      "mergeTwoLists(self, list1, list2)",
      `        dummy = ListNode()
        tail = dummy
        while list1 is not None and list2 is not None:
            if list1.val <= list2.val:
                tail.next = list1
                list1 = list1.next
            else:
                tail.next = list2
                list2 = list2.next
            tail = tail.next
        tail.next = list1 if list1 is not None else list2
        return dummy.next
`,
      listHelpers,
      `
def run(values1, values2):
    list1 = build_list(values1)
    list2 = build_list(values2)
    result = Solution().mergeTwoLists(list1, list2)
    return list_values(result)
`,
    ),
    cases: [
      {
        name: "Interleaved nodes",
        args: [
          [1, 2, 4],
          [1, 3, 4],
        ],
        expected: [1, 1, 2, 3, 4, 4],
      },
      { name: "Both empty", args: [[], []], expected: [] },
      { name: "One empty", args: [[], [0]], expected: [0] },
      {
        name: "Negative values",
        args: [
          [-3, -1],
          [-2, 0],
        ],
        expected: [-3, -2, -1, 0],
      },
    ],
  },
  {
    id: "linked-list-cycle",
    number: 141,
    title: "Linked List Cycle",
    pattern: "Fast and slow pointers",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/linked-list-cycle/",
    summary:
      "Detect whether following next pointers eventually revisits a node. DebugRoom's run(values, pos) adapter builds a real list and connects the tail to the zero-based pos node, or leaves it unlinked for −1. LeetCode passes only head to hasCycle.",
    constraints: [
      "0 ≤ node count ≤ 10,000",
      "−100,000 ≤ node.val ≤ 100,000",
      "pos is −1 or a valid zero-based node index.",
    ],
    hints: [
      "Use one pointer that moves one link and another that moves two.",
      "Compare node identity, not values: distinct nodes may hold the same value.",
      "If fast reaches the end there is no cycle; inside a cycle it eventually catches slow.",
    ],
    time: "O(n) for the algorithm",
    space: "O(1) for the algorithm; O(n) for the adapter",
    watch:
      "In hasCycle, slow advances once and fast twice. Follow the actual next links back into the cycle and watch both references meet. The run adapter creates the cycle before calling the method and returns only its boolean result.",
    entryPoint: "run",
    ...program(
      "hasCycle(self, head)",
      `        slow = head
        fast = head
        while fast is not None and fast.next is not None:
            slow = slow.next
            fast = fast.next.next
            if slow is fast:
                return True
        return False
`,
      listHelpers,
      `
def run(values, pos):
    head = build_list(values)
    if pos != -1:
        if pos < 0 or pos >= len(values):
            raise ValueError("pos must be -1 or a valid node index")
        tail = head
        target = head
        for _ in range(pos):
            target = target.next
        while tail.next is not None:
            tail = tail.next
        tail.next = target
    return Solution().hasCycle(head)
`,
    ),
    cases: [
      {
        name: "Tail points into middle",
        args: [[3, 2, 0, -4], 1],
        expected: true,
      },
      { name: "No cycle", args: [[1, 2, 3], -1], expected: false },
      { name: "Self cycle", args: [[1], 0], expected: true },
      { name: "Empty list", args: [[], -1], expected: false },
      {
        name: "Equal values, distinct nodes",
        args: [[1, 1], -1],
        expected: false,
      },
    ],
  },
  {
    id: "invert-binary-tree",
    number: 226,
    title: "Invert Binary Tree",
    pattern: "Tree recursion",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/invert-binary-tree/",
    summary:
      "Mirror a binary tree by swapping the left and right children at every node. The run(values) adapter accepts a level-order JSON array with null for missing children, builds TreeNode objects, and serializes the mirrored tree. LeetCode passes root directly.",
    constraints: [
      "0 ≤ node count ≤ 100",
      "−100 ≤ node.val ≤ 100",
      "Input uses level order; null marks a missing child.",
    ],
    hints: [
      "An empty subtree is already inverted.",
      "Swap a node's children, then apply the same operation to both child subtrees.",
      "Return the original root reference after its descendants have been updated.",
    ],
    time: "O(n) for the algorithm",
    space: "O(h) recursive stack; O(n) for the adapter",
    watch:
      "Select the invertTree frames to follow recursive descent while each node's left and right links exchange places. The run helpers use breadth-first input/output, omitting trailing nulls from the result.",
    entryPoint: "run",
    ...program(
      "invertTree(self, root)",
      `        if root is None:
            return None
        root.left, root.right = root.right, root.left
        self.invertTree(root.left)
        self.invertTree(root.right)
        return root
`,
      treeHelpers,
      `
def run(values):
    root = build_tree(values)
    result = Solution().invertTree(root)
    return tree_values(result)
`,
    ),
    cases: [
      {
        name: "Balanced tree",
        args: [[4, 2, 7, 1, 3, 6, 9]],
        expected: [4, 7, 2, 9, 6, 3, 1],
      },
      { name: "Empty tree", args: [[]], expected: [] },
      { name: "Single node", args: [[1]], expected: [1] },
      {
        name: "Missing child",
        args: [[1, 2, 3, null, 4]],
        expected: [1, 3, 2, null, null, 4],
      },
    ],
  },
];
