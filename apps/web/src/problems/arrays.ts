import type { PracticeProblem } from "./types";

export const arrayProblems: PracticeProblem[] = [
  {
    id: "two-sum",
    number: 1,
    title: "Two Sum",
    pattern: "Hash map",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/two-sum/",
    summary:
      "Find the two different indices whose values add up to target. Each input has exactly one answer; return the indices in either order.",
    constraints: [
      "2 ≤ nums.length ≤ 10,000",
      "Values and target are integers between −1 billion and 1 billion.",
      "Exactly one pair exists, and an element cannot pair with itself.",
    ],
    hints: [
      "For each value, which complement would complete the target?",
      "Keep a map from values already visited to their indices.",
      "Look for the complement before saving the current value so you never reuse its index.",
    ],
    time: "O(n)",
    space: "O(n)",
    watch:
      "Follow i across nums and inspect complement and seen. The map grows until a previously visited value completes the pair.",
    entryPoint: "Solution.twoSum",
    solution: `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for i in range(len(nums)):
            value = nums[i]
            complement = target - value
            if complement in seen:
                return [seen[complement], i]
            seen[value] = i
        return []
`,
    starter: `class Solution:
    def twoSum(self, nums, target):
        # Return the indices of the two values that sum to target.
        pass
`,
    cases: [
      {
        name: "Find a complement",
        args: [[2, 7, 11, 15], 9],
        expected: [0, 1],
      },
      { name: "Answer appears later", args: [[3, 2, 4], 6], expected: [1, 2] },
      {
        name: "Equal values, different indices",
        args: [[3, 3], 6],
        expected: [0, 1],
      },
      { name: "Negative values", args: [[-3, 4, 3, 90], 0], expected: [0, 2] },
    ],
  },
  {
    id: "best-time-to-buy-and-sell-stock",
    number: 121,
    title: "Best Time to Buy and Sell Stock",
    pattern: "One-pass scan",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/best-time-to-buy-and-sell-stock/",
    summary:
      "Choose one day to buy and a later day to sell. Return the largest possible profit, or zero when every trade would lose money.",
    constraints: [
      "1 ≤ prices.length ≤ 100,000",
      "0 ≤ prices[i] ≤ 10,000",
      "At most one buy and one later sell.",
    ],
    hints: [
      "If today is the selling day, the best buying day has the lowest earlier price.",
      "Track the lowest price seen and the best profit as you scan once.",
    ],
    time: "O(n)",
    space: "O(1)",
    watch:
      "Follow i through the prices. lowest_price remembers the cheapest day so far while profit and best_profit reveal each possible improvement.",
    entryPoint: "Solution.maxProfit",
    solution: `class Solution:
    def maxProfit(self, prices):
        lowest_price = prices[0]
        best_profit = 0
        for i in range(1, len(prices)):
            price = prices[i]
            profit = price - lowest_price
            best_profit = max(best_profit, profit)
            lowest_price = min(lowest_price, price)
        return best_profit
`,
    starter: `class Solution:
    def maxProfit(self, prices):
        # Return the best profit from one buy followed by one sell.
        pass
`,
    cases: [
      { name: "Buy low, sell later", args: [[7, 1, 5, 3, 6, 4]], expected: 5 },
      { name: "Prices only fall", args: [[7, 6, 4, 3, 1]], expected: 0 },
      { name: "One day", args: [[5]], expected: 0 },
      { name: "Later valley", args: [[3, 8, 1, 10]], expected: 9 },
    ],
  },
  {
    id: "contains-duplicate",
    number: 217,
    title: "Contains Duplicate",
    pattern: "Hash set",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/contains-duplicate/",
    summary:
      "Return true when any value appears more than once in nums. Otherwise return false.",
    constraints: [
      "1 ≤ nums.length ≤ 100,000",
      "−1 billion ≤ nums[i] ≤ 1 billion",
    ],
    hints: [
      "You only need to know whether a value has appeared before, not its index.",
      "Use a set and stop immediately when the current value is already present.",
    ],
    time: "O(n)",
    space: "O(n)",
    watch:
      "Watch i visit each value and seen accumulate distinct numbers. Playback stops as soon as a repeated value is discovered.",
    entryPoint: "Solution.containsDuplicate",
    solution: `class Solution:
    def containsDuplicate(self, nums):
        seen = set()
        for i in range(len(nums)):
            value = nums[i]
            if value in seen:
                return True
            seen.add(value)
        return False
`,
    starter: `class Solution:
    def containsDuplicate(self, nums):
        # Return whether any value appears at least twice.
        pass
`,
    cases: [
      { name: "Repeat at the end", args: [[1, 2, 3, 1]], expected: true },
      { name: "All distinct", args: [[1, 2, 3, 4]], expected: false },
      { name: "Single value", args: [[0]], expected: false },
      { name: "Negative duplicate", args: [[-1, 2, -1]], expected: true },
    ],
  },
  {
    id: "move-zeroes",
    number: 283,
    title: "Move Zeroes",
    pattern: "Two pointers",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/move-zeroes/",
    summary:
      "Move every zero to the end of nums in place while preserving the order of nonzero values. LeetCode's method returns nothing; the included run wrapper returns the mutated list so you can inspect and check it here.",
    constraints: [
      "1 ≤ nums.length ≤ 10,000",
      "Values are signed 32-bit integers.",
      "Modify nums in place using constant extra space.",
    ],
    hints: [
      "Let write mark the next position that should contain a nonzero value.",
      "Scan with read. When a nonzero value appears, swap it into write and advance write.",
      "Everything before write stays in its original nonzero order.",
    ],
    time: "O(n)",
    space: "O(1)",
    watch:
      "Follow read and write on the same array as nonzero values move left and zeroes move right. The run wrapper exposes the final mutated array without changing the LeetCode method signature.",
    entryPoint: "run",
    solution: `class Solution:
    def moveZeroes(self, nums):
        write = 0
        for read in range(len(nums)):
            if nums[read] != 0:
                nums[write], nums[read] = nums[read], nums[write]
                write += 1

def run(nums):
    Solution().moveZeroes(nums)
    return nums
`,
    starter: `class Solution:
    def moveZeroes(self, nums):
        # Modify nums in place. Do not return a new list.
        pass

def run(nums):
    Solution().moveZeroes(nums)
    return nums
`,
    cases: [
      {
        name: "Interleaved zeroes",
        args: [[0, 1, 0, 3, 12]],
        expected: [1, 3, 12, 0, 0],
      },
      { name: "Only zero", args: [[0]], expected: [0] },
      { name: "Already compact", args: [[1, 2, 3]], expected: [1, 2, 3] },
      {
        name: "Keep negative order",
        args: [[0, -1, 0, -2]],
        expected: [-1, -2, 0, 0],
      },
    ],
  },
  {
    id: "binary-search",
    number: 704,
    title: "Binary Search",
    pattern: "Binary search",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/binary-search/",
    summary:
      "Find target in a strictly increasing array and return its index. Return −1 when target is absent. Use a logarithmic-time search.",
    constraints: [
      "1 ≤ nums.length ≤ 10,000",
      "−10,000 < nums[i], target < 10,000",
      "nums is sorted in increasing order with no duplicates.",
    ],
    hints: [
      "Compare target with the middle value to discard half the remaining positions.",
      "Keep the candidate interval inclusive: low through high.",
      "After a mismatch, move past mid so the search always makes progress.",
    ],
    time: "O(log n)",
    space: "O(1)",
    watch:
      "Follow low, mid, and high over nums as the search window shrinks. An unsuccessful search ends when low passes high.",
    entryPoint: "Solution.search",
    solution: `class Solution:
    def search(self, nums, target):
        low = 0
        high = len(nums) - 1
        while low <= high:
            mid = (low + high) // 2
            value = nums[mid]
            if value == target:
                return mid
            if value < target:
                low = mid + 1
            else:
                high = mid - 1
        return -1
`,
    starter: `class Solution:
    def search(self, nums, target):
        # Return the target's index, or -1 if absent, in O(log n) time.
        pass
`,
    cases: [
      {
        name: "Target on the right",
        args: [[-1, 0, 3, 5, 9, 12], 9],
        expected: 4,
      },
      { name: "Target missing", args: [[-1, 0, 3, 5, 9, 12], 2], expected: -1 },
      { name: "Single match", args: [[5], 5], expected: 0 },
      { name: "Left boundary", args: [[1, 3, 5, 7], 1], expected: 0 },
    ],
  },
  {
    id: "majority-element",
    number: 169,
    title: "Majority Element",
    pattern: "Boyer–Moore voting",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/majority-element/",
    summary:
      "Find the value that appears in more than half of nums. A majority value is guaranteed to exist.",
    constraints: [
      "1 ≤ nums.length ≤ 50,000",
      "−1 billion ≤ nums[i] ≤ 1 billion",
      "One value occurs more than floor(n / 2) times.",
    ],
    hints: [
      "Imagine cancelling pairs of different values: the majority must survive.",
      "Track one candidate and a balance; matching values increase the balance and others decrease it.",
      "When the balance is zero, the next value can become the candidate.",
    ],
    time: "O(n)",
    space: "O(1)",
    watch:
      "Watch candidate and balance change as i moves across nums. Opposing values cancel votes until the guaranteed majority survives.",
    entryPoint: "Solution.majorityElement",
    solution: `class Solution:
    def majorityElement(self, nums):
        candidate = nums[0]
        balance = 0
        for i in range(len(nums)):
            value = nums[i]
            if balance == 0:
                candidate = value
            if value == candidate:
                balance += 1
            else:
                balance -= 1
        return candidate
`,
    starter: `class Solution:
    def majorityElement(self, nums):
        # Return the guaranteed majority value.
        pass
`,
    cases: [
      {
        name: "Cancel opposing votes",
        args: [[2, 2, 1, 1, 1, 2, 2]],
        expected: 2,
      },
      { name: "Small majority", args: [[3, 2, 3]], expected: 3 },
      { name: "Single vote", args: [[-1]], expected: -1 },
      { name: "New candidate wins", args: [[1, 2, 2]], expected: 2 },
    ],
  },
  {
    id: "single-number",
    number: 136,
    title: "Single Number",
    pattern: "Bit manipulation",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/single-number/",
    summary:
      "Every value appears exactly twice except one value that appears once. Find that single value in linear time with constant extra space.",
    constraints: [
      "1 ≤ nums.length ≤ 30,000",
      "−30,000 ≤ nums[i] ≤ 30,000",
      "Exactly one value occurs once; every other value occurs twice.",
    ],
    hints: [
      "XOR of a value with itself is zero; XOR with zero leaves the value unchanged.",
      "XOR all the values together. Paired values cancel regardless of their positions.",
    ],
    time: "O(n)",
    space: "O(1)",
    watch:
      "Follow i and the running xor_total. Every update is a real bitwise XOR; after all pairs cancel, the accumulator holds the single value.",
    entryPoint: "Solution.singleNumber",
    solution: `class Solution:
    def singleNumber(self, nums):
        xor_total = 0
        for i in range(len(nums)):
            value = nums[i]
            xor_total ^= value
        return xor_total
`,
    starter: `class Solution:
    def singleNumber(self, nums):
        # Find the unpaired value in O(n) time and O(1) extra space.
        pass
`,
    cases: [
      { name: "Separated pairs", args: [[4, 1, 2, 1, 2]], expected: 4 },
      { name: "Small pair", args: [[2, 2, 1]], expected: 1 },
      { name: "Only value", args: [[1]], expected: 1 },
      { name: "Negative and zero", args: [[-1, 0, 0]], expected: -1 },
    ],
  },
  {
    id: "climbing-stairs",
    number: 70,
    title: "Climbing Stairs",
    pattern: "Dynamic programming",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/climbing-stairs/",
    summary:
      "Count the distinct sequences of one-step and two-step moves that reach the top of a staircase with n steps.",
    constraints: ["1 ≤ n ≤ 45", "Each move climbs either one or two steps."],
    hints: [
      "The final move comes from either the preceding step or two steps below.",
      "ways(step) = ways(step − 1) + ways(step − 2). Start with one way to stand at step zero and one way to reach step one.",
      "Keep only the previous two counts to use constant extra space.",
    ],
    time: "O(n)",
    space: "O(1)",
    watch:
      "Follow step, two_back, one_back, and ways. Each new count combines the two earlier counts before the rolling state advances.",
    entryPoint: "Solution.climbStairs",
    solution: `class Solution:
    def climbStairs(self, n):
        two_back = 1
        one_back = 1
        for step in range(2, n + 1):
            ways = two_back + one_back
            two_back = one_back
            one_back = ways
        return one_back
`,
    starter: `class Solution:
    def climbStairs(self, n):
        # Return the number of ways to climb n steps using 1 or 2 at a time.
        pass
`,
    cases: [
      { name: "Build the recurrence", args: [5], expected: 8 },
      { name: "Two steps", args: [2], expected: 2 },
      { name: "Three steps", args: [3], expected: 3 },
      { name: "One step", args: [1], expected: 1 },
      { name: "Largest staircase", args: [45], expected: 1836311903 },
    ],
  },
];
