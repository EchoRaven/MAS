# Coding problems in HumanEval form, each with a reference solution.
# build.py checks every reference against its tests in Docker, then writes JSON lines.
P = []

def add(entry, prompt, test, ref):
    P.append({"entry_point": entry, "prompt": prompt, "test": test, "ref": ref})

add("roman_to_int", '''def roman_to_int(s: str) -> int:
    """Convert a Roman numeral (I, V, X, L, C, D, M; subtractive forms like IV, XC, CM) to an integer.
    >>> roman_to_int("MCMXCIV")
    1994
    """
''', '''def check(candidate):
    assert candidate("III") == 3
    assert candidate("IV") == 4
    assert candidate("IX") == 9
    assert candidate("LVIII") == 58
    assert candidate("MCMXCIV") == 1994
    assert candidate("MMMCMXCIX") == 3999
    assert candidate("XLIX") == 49
''', '''    v = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    t = 0
    for i, c in enumerate(s):
        if i + 1 < len(s) and v[c] < v[s[i + 1]]:
            t -= v[c]
        else:
            t += v[c]
    return t
''')

add("merge_intervals", '''from typing import List


def merge_intervals(intervals: List[List[int]]) -> List[List[int]]:
    """Merge overlapping closed intervals [a, b]; intervals that touch (b == next a) merge too.
    Return them sorted by start. The input may be unsorted and empty.
    >>> merge_intervals([[1, 3], [8, 10], [2, 6]])
    [[1, 6], [8, 10]]
    """
''', '''def check(candidate):
    assert candidate([]) == []
    assert candidate([[1, 3], [8, 10], [2, 6]]) == [[1, 6], [8, 10]]
    assert candidate([[1, 4], [4, 5]]) == [[1, 5]]
    assert candidate([[5, 7], [1, 2]]) == [[1, 2], [5, 7]]
    assert candidate([[1, 10], [2, 3], [4, 5]]) == [[1, 10]]
    assert candidate([[3, 3]]) == [[3, 3]]
''', '''    out = []
    for a, b in sorted(intervals):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out
''')

add("eval_rpn", '''from typing import List


def eval_rpn(tokens: List[str]) -> int:
    """Evaluate an expression in reverse Polish notation with + - * /.
    Division truncates toward zero (so -7 / 2 is -3). Numbers may be negative.
    >>> eval_rpn(["2", "1", "+", "3", "*"])
    9
    """
''', '''def check(candidate):
    assert candidate(["2", "1", "+", "3", "*"]) == 9
    assert candidate(["4", "13", "5", "/", "+"]) == 6
    assert candidate(["10", "6", "9", "3", "+", "-11", "*", "/", "*", "17", "+", "5", "+"]) == 22
    assert candidate(["-7", "2", "/"]) == -3
    assert candidate(["7", "-2", "/"]) == -3
    assert candidate(["42"]) == 42
''', '''    st = []
    for t in tokens:
        if t in ("+", "-", "*", "/"):
            b, a = st.pop(), st.pop()
            if t == "+": st.append(a + b)
            elif t == "-": st.append(a - b)
            elif t == "*": st.append(a * b)
            else: st.append(int(a / b))
        else:
            st.append(int(t))
    return st[0]
''')

add("longest_unique_substring", '''def longest_unique_substring(s: str) -> int:
    """Length of the longest substring with no repeated character.
    >>> longest_unique_substring("abcabcbb")
    3
    """
''', '''def check(candidate):
    assert candidate("abcabcbb") == 3
    assert candidate("bbbbb") == 1
    assert candidate("pwwkew") == 3
    assert candidate("") == 0
    assert candidate("abba") == 2
    assert candidate("dvdf") == 3
    assert candidate(" ") == 1
''', '''    seen = {}
    start = best = 0
    for i, c in enumerate(s):
        if c in seen and seen[c] >= start:
            start = seen[c] + 1
        seen[c] = i
        best = max(best, i - start + 1)
    return best
''')

add("spiral_order", '''from typing import List


def spiral_order(matrix: List[List[int]]) -> List[int]:
    """The elements of a matrix in clockwise spiral order, starting top-left. The matrix may be empty or not square.
    >>> spiral_order([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
    [1, 2, 3, 6, 9, 8, 7, 4, 5]
    """
''', '''def check(candidate):
    assert candidate([[1, 2, 3], [4, 5, 6], [7, 8, 9]]) == [1, 2, 3, 6, 9, 8, 7, 4, 5]
    assert candidate([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]) == [1, 2, 3, 4, 8, 12, 11, 10, 9, 5, 6, 7]
    assert candidate([]) == []
    assert candidate([[1]]) == [1]
    assert candidate([[1], [2], [3]]) == [1, 2, 3]
    assert candidate([[1, 2], [3, 4], [5, 6]]) == [1, 2, 4, 6, 5, 3]
''', '''    out = []
    m = [row[:] for row in matrix]
    while m:
        out += m.pop(0)
        if m and m[0]:
            for row in m:
                out.append(row.pop())
        if m:
            out += m.pop()[::-1]
        if m and m[0]:
            for row in m[::-1]:
                out.append(row.pop(0))
        m = [r for r in m if r]
    return out
''')

add("next_permutation", '''from typing import List


def next_permutation(nums: List[int]) -> List[int]:
    """The next lexicographically greater permutation of nums, as a new list.
    If nums is the last permutation, return the first (sorted ascending). Values may repeat.
    >>> next_permutation([1, 2, 3])
    [1, 3, 2]
    """
''', '''def check(candidate):
    assert candidate([1, 2, 3]) == [1, 3, 2]
    assert candidate([3, 2, 1]) == [1, 2, 3]
    assert candidate([1, 1, 5]) == [1, 5, 1]
    assert candidate([1, 3, 2]) == [2, 1, 3]
    assert candidate([2, 2, 0, 4, 3, 1]) == [2, 2, 1, 0, 3, 4]
    assert candidate([1]) == [1]
    assert candidate([1, 5, 1]) == [5, 1, 1]
''', '''    a = nums[:]
    i = len(a) - 2
    while i >= 0 and a[i] >= a[i + 1]:
        i -= 1
    if i >= 0:
        j = len(a) - 1
        while a[j] <= a[i]:
            j -= 1
        a[i], a[j] = a[j], a[i]
    a[i + 1:] = reversed(a[i + 1:])
    return a
''')

add("decode_string", '''def decode_string(s: str) -> str:
    """Decode k[encoded] repetitions, which may nest: "3[a2[c]]" is "accaccacc". k can have several digits.
    >>> decode_string("3[a]2[bc]")
    'aaabcbc'
    """
''', '''def check(candidate):
    assert candidate("3[a]2[bc]") == "aaabcbc"
    assert candidate("3[a2[c]]") == "accaccacc"
    assert candidate("2[abc]3[cd]ef") == "abcabccdcdcdef"
    assert candidate("abc") == "abc"
    assert candidate("10[a]") == "a" * 10
    assert candidate("2[2[2[x]]y]") == "xxxxyxxxxy"
''', '''    st, num, cur = [], 0, ""
    for c in s:
        if c.isdigit():
            num = num * 10 + int(c)
        elif c == "[":
            st.append((cur, num)); cur, num = "", 0
        elif c == "]":
            prev, k = st.pop(); cur = prev + cur * k
        else:
            cur += c
    return cur
''')

add("min_window", '''def min_window(s: str, t: str) -> str:
    """The shortest substring of s containing every character of t, counting repeats.
    Return "" if there is none. If several are shortest, return the leftmost.
    >>> min_window("ADOBECODEBANC", "ABC")
    'BANC'
    """
''', '''def check(candidate):
    assert candidate("ADOBECODEBANC", "ABC") == "BANC"
    assert candidate("a", "a") == "a"
    assert candidate("a", "aa") == ""
    assert candidate("aa", "aa") == "aa"
    assert candidate("abcabdebac", "cda") == "cabd"
    assert candidate("xyz", "") == ""
    assert candidate("bba", "ab") == "ba"
''', '''    if not t:
        return ""
    from collections import Counter
    need = Counter(t); missing = len(t)
    best = (0, float("inf")); left = 0
    for right, c in enumerate(s):
        if need[c] > 0:
            missing -= 1
        need[c] -= 1
        if missing == 0:
            while need[s[left]] < 0:
                need[s[left]] += 1; left += 1
            if right - left < best[1] - best[0]:
                best = (left, right)
            need[s[left]] += 1; missing += 1; left += 1
    return "" if best[1] == float("inf") else s[best[0]:best[1] + 1]
''')

add("word_break_count", '''from typing import List


def word_break_count(s: str, words: List[str]) -> int:
    """The number of ways to split s into a sequence of words from the list (words may be reused).
    >>> word_break_count("catsanddog", ["cat", "cats", "and", "sand", "dog"])
    2
    """
''', '''def check(candidate):
    assert candidate("catsanddog", ["cat", "cats", "and", "sand", "dog"]) == 2
    assert candidate("pineapplepenapple", ["apple", "pen", "applepen", "pine", "pineapple"]) == 3
    assert candidate("catsandog", ["cats", "dog", "sand", "and", "cat"]) == 0
    assert candidate("", ["a"]) == 1
    assert candidate("aaaa", ["a", "aa"]) == 5
''', '''    n = len(s); ways = [0] * (n + 1); ways[0] = 1
    ws = set(words)
    for i in range(1, n + 1):
        for w in ws:
            if len(w) <= i and s[i - len(w):i] == w:
                ways[i] += ways[i - len(w)]
    return ways[n]
''')

add("days_between", '''def days_between(a: str, b: str) -> int:
    """The number of days from date a to date b, both "YYYY-MM-DD"; negative if b is before a.
    Do not import datetime or calendar: handle leap years yourself (Gregorian rules).
    >>> days_between("2020-02-28", "2020-03-01")
    2
    """
''', '''def check(candidate):
    import builtins
    assert candidate("2020-02-28", "2020-03-01") == 2
    assert candidate("2019-02-28", "2019-03-01") == 1
    assert candidate("2000-01-01", "2000-12-31") == 365
    assert candidate("1900-01-01", "1901-01-01") == 365
    assert candidate("2024-03-01", "2023-03-01") == -366
    assert candidate("1999-12-31", "2000-01-01") == 1
    assert candidate("1600-01-01", "2000-01-01") == 146097
''', '''    def n(d):
        y, m, dd = map(int, d.split("-"))
        if m < 3:
            y -= 1; m += 12
        return 365 * y + y // 4 - y // 100 + y // 400 + (153 * (m - 3) + 2) // 5 + dd
    return n(b) - n(a)
''')

add("calc", '''def calc(expr: str) -> int:
    """Evaluate an integer expression with + - * / and parentheses, spaces allowed, and unary minus
    ("-(2+3)", "2*-3"). / is integer division truncating toward zero. Do not use eval.
    >>> calc("2 + 3 * (4 - 1)")
    11
    """
''', '''def check(candidate):
    import builtins
    real = builtins.eval
    def no_eval(*a, **k):
        raise AssertionError("eval is not allowed")
    builtins.eval = no_eval
    try:
        assert candidate("2 + 3 * (4 - 1)") == 11
        assert candidate("-(2+3)") == -5
        assert candidate("2*-3") == -6
        assert candidate("7/2") == 3
        assert candidate("-7/2") == -3
        assert candidate(" 1 - (2 - (3 - 4)) ") == -2
        assert candidate("10 - 2 - 3") == 5
        assert candidate("2*(3+4)*5/7") == 10
    finally:
        builtins.eval = real
''', '''    toks = []
    i = 0
    while i < len(expr):
        c = expr[i]
        if c.isspace():
            i += 1
        elif c.isdigit():
            j = i
            while j < len(expr) and expr[j].isdigit():
                j += 1
            toks.append(int(expr[i:j])); i = j
        else:
            toks.append(c); i += 1
    pos = 0
    def peek():
        return toks[pos] if pos < len(toks) else None
    def take():
        nonlocal pos
        pos += 1
        return toks[pos - 1]
    def expr_():
        v = term()
        while peek() in ("+", "-"):
            op = take(); r = term()
            v = v + r if op == "+" else v - r
        return v
    def term():
        v = unary()
        while peek() in ("*", "/"):
            op = take(); r = unary()
            v = v * r if op == "*" else int(v / r)
        return v
    def unary():
        if peek() == "-":
            take(); return -unary()
        if peek() == "+":
            take(); return unary()
        if peek() == "(":
            take(); v = expr_(); take(); return v
        return take()
    return expr_()
''')

add("is_valid_sudoku", '''from typing import List


def is_valid_sudoku(board: List[str]) -> bool:
    """Whether a partly filled 9x9 sudoku (nine strings of digits and '.') breaks no rule:
    no digit twice in a row, a column, or a 3x3 box. It need not be solvable.
    """
''', '''def check(candidate):
    good = ["53..7....", "6..195...", ".98....6.", "8...6...3", "4..8.3..1", "7...2...6", ".6....28.", "...419..5", "....8..79"]
    assert candidate(good) is True
    bad_box = ["83..7....", "6..195...", ".98....6.", "8...6...3", "4..8.3..1", "7...2...6", ".6....28.", "...419..5", "....8..79"]
    assert candidate(bad_box) is False
    bad_row = ["55..7...."] + good[1:]
    assert candidate(bad_row) is False
    bad_col = good[:8] + ["5...8..79"]
    assert candidate(bad_col) is False
    assert candidate(["........."] * 9) is True
''', '''    for i in range(9):
        row = [c for c in board[i] if c != "."]
        col = [board[r][i] for r in range(9) if board[r][i] != "."]
        box = [board[3 * (i // 3) + r][3 * (i % 3) + c] for r in range(3) for c in range(3)]
        box = [c for c in box if c != "."]
        if len(set(row)) != len(row) or len(set(col)) != len(col) or len(set(box)) != len(box):
            return False
    return True
''')

add("lru_simulate", '''from typing import List, Tuple


def lru_simulate(capacity: int, ops: List[Tuple]) -> List[int]:
    """Simulate an LRU cache. ops are ("put", key, value) or ("get", key).
    Return the results of the gets in order: the value, or -1 if absent. A get and a put both make the key
    most recently used; a put beyond capacity evicts the least recently used key.
    """
''', '''def check(candidate):
    ops = [("put", 1, 1), ("put", 2, 2), ("get", 1), ("put", 3, 3), ("get", 2), ("put", 4, 4), ("get", 1), ("get", 3), ("get", 4)]
    assert candidate(2, ops) == [1, -1, -1, 3, 4]
    assert candidate(1, [("put", 1, 1), ("put", 1, 5), ("get", 1), ("put", 2, 2), ("get", 1), ("get", 2)]) == [5, -1, 2]
    assert candidate(2, [("put", 1, 1), ("put", 2, 2), ("put", 1, 10), ("put", 3, 3), ("get", 2), ("get", 1)]) == [-1, 10]
    assert candidate(3, [("get", 7)]) == [-1]
''', '''    from collections import OrderedDict
    c = OrderedDict(); out = []
    for op in ops:
        if op[0] == "get":
            k = op[1]
            if k in c:
                c.move_to_end(k); out.append(c[k])
            else:
                out.append(-1)
        else:
            _, k, v = op
            if k in c:
                c.move_to_end(k)
            c[k] = v
            if len(c) > capacity:
                c.popitem(last=False)
    return out
''')

add("int_to_english", '''def int_to_english(n: int) -> str:
    """Write a non-negative integer below one billion in English words, as in
    "One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven". Zero is "Zero". No "and", no hyphens.
    """
''', '''def check(candidate):
    assert candidate(0) == "Zero"
    assert candidate(5) == "Five"
    assert candidate(13) == "Thirteen"
    assert candidate(20) == "Twenty"
    assert candidate(123) == "One Hundred Twenty Three"
    assert candidate(12345) == "Twelve Thousand Three Hundred Forty Five"
    assert candidate(1000010) == "One Million Ten"
    assert candidate(1234567) == "One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven"
    assert candidate(100000000) == "One Hundred Million"
''', '''    if n == 0:
        return "Zero"
    ones = "Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen".split()
    tens = "_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety".split()
    def three(x):
        w = []
        if x >= 100:
            w += [ones[x // 100], "Hundred"]; x %= 100
        if x >= 20:
            w.append(tens[x // 10]); x %= 10
        if x:
            w.append(ones[x])
        return w
    w = []
    for div, name in ((1000000, "Million"), (1000, "Thousand"), (1, "")):
        if n >= div:
            w += three(n // div) + ([name] if name else []); n %= div
    return " ".join(w)
''')

add("count_islands", '''from typing import List


def count_islands(grid: List[str]) -> int:
    """Count islands of '1' cells joined up, down, left or right (not diagonally) in a grid of '0'/'1' strings.
    The grid can be large (up to 300x300): avoid deep recursion.
    """
''', '''def check(candidate):
    assert candidate(["11110", "11010", "11000", "00000"]) == 1
    assert candidate(["11000", "11000", "00100", "00011"]) == 3
    assert candidate([]) == 0
    assert candidate(["101", "010", "101"]) == 5
    big = ["1" * 300] * 300
    assert candidate(big) == 1
    snake = ["".join("1" if (r % 4 == 0 or (r % 4 == 1 and c == 299) or (r % 4 == 2) or (r % 4 == 3 and c == 0)) else "0" for c in range(300)) for r in range(300)]
    assert candidate(snake) == 1
''', '''    if not grid:
        return 0
    R, C = len(grid), len(grid[0]); seen = [[False] * C for _ in range(R)]; n = 0
    for r in range(R):
        for c in range(C):
            if grid[r][c] == "1" and not seen[r][c]:
                n += 1; st = [(r, c)]; seen[r][c] = True
                while st:
                    y, x = st.pop()
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        a, b = y + dy, x + dx
                        if 0 <= a < R and 0 <= b < C and grid[a][b] == "1" and not seen[a][b]:
                            seen[a][b] = True; st.append((a, b))
    return n
''')

add("format_duration", '''def format_duration(seconds: int) -> str:
    """Human-readable duration: years (365 days), days, hours, minutes, seconds; zero units left out;
    units joined by ", " except the last two, joined by " and "; singular for 1. Zero is "now".
    >>> format_duration(3662)
    '1 hour, 1 minute and 2 seconds'
    """
''', '''def check(candidate):
    assert candidate(0) == "now"
    assert candidate(1) == "1 second"
    assert candidate(62) == "1 minute and 2 seconds"
    assert candidate(120) == "2 minutes"
    assert candidate(3600) == "1 hour"
    assert candidate(3662) == "1 hour, 1 minute and 2 seconds"
    assert candidate(15731080) == "182 days, 1 hour, 44 minutes and 40 seconds"
    assert candidate(132030240) == "4 years, 68 days, 3 hours and 4 minutes"
''', '''    if seconds == 0:
        return "now"
    parts = []
    for name, size in (("year", 31536000), ("day", 86400), ("hour", 3600), ("minute", 60), ("second", 1)):
        k, seconds = divmod(seconds, size)
        if k:
            parts.append(f"{k} {name}{'s' if k > 1 else ''}")
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
''')

add("kth_smallest_pair_distance", '''from typing import List


def kth_smallest_pair_distance(nums: List[int], k: int) -> int:
    """The k-th smallest absolute difference |a - b| over all pairs i < j (k counts from 1).
    nums can have up to 2000 elements: an O(n^2 log n) solution is too slow within 10 seconds only if written carelessly.
    """
''', '''def check(candidate):
    assert candidate([1, 3, 1], 1) == 0
    assert candidate([1, 1, 1], 2) == 0
    assert candidate([1, 6, 1], 3) == 5
    assert candidate([9, 10, 7, 10, 6, 1, 5, 4, 9, 8], 18) == 2
    import random
    rnd = random.Random(7)
    xs = [rnd.randrange(0, 10**6) for _ in range(2000)]
    s = sorted(xs)
    # the 1st smallest is the smallest gap between neighbours in sorted order
    assert candidate(xs, 1) == min(b - a for a, b in zip(s, s[1:]))
    assert candidate(xs, 2000 * 1999 // 2) == s[-1] - s[0]
''', '''    a = sorted(nums)
    lo, hi = 0, a[-1] - a[0]
    def count(d):
        c = j = 0
        for i in range(len(a)):
            while a[i] - a[j] > d:
                j += 1
            c += i - j
        return c
    while lo < hi:
        mid = (lo + hi) // 2
        if count(mid) >= k:
            hi = mid
        else:
            lo = mid + 1
    return lo
''')

add("parse_csv_line", '''from typing import List


def parse_csv_line(line: str) -> List[str]:
    """Split one CSV line into fields. Fields may be quoted with double quotes; inside quotes, commas are
    literal and "" is one quote character. Unquoted fields are kept as they are (spaces included). Do not use the csv module.
    >>> parse_csv_line('a,"b,c",d')
    ['a', 'b,c', 'd']
    """
''', '''def check(candidate):
    import sys
    sys.modules["csv"] = None
    assert candidate('a,"b,c",d') == ["a", "b,c", "d"]
    assert candidate('') == [""]
    assert candidate('a,,b') == ["a", "", "b"]
    assert candidate('"he said ""hi""",x') == ['he said "hi"', "x"]
    assert candidate(' a , b ') == [" a ", " b "]
    assert candidate('"",""') == ["", ""]
    assert candidate('x,') == ["x", ""]
''', '''    out, cur, q, i = [], "", False, 0
    while i < len(line):
        c = line[i]
        if q:
            if c == '"':
                if i + 1 < len(line) and line[i + 1] == '"':
                    cur += '"'; i += 1
                else:
                    q = False
            else:
                cur += c
        elif c == '"':
            q = True
        elif c == ",":
            out.append(cur); cur = ""
        else:
            cur += c
        i += 1
    out.append(cur)
    return out
''')

add("topo_order", '''from typing import List, Tuple


def topo_order(n: int, edges: List[Tuple[int, int]]) -> List[int]:
    """Tasks 0..n-1; an edge (a, b) means a must come before b. Return an order that respects every edge,
    choosing the smallest-numbered available task at each step. Return [] if there is a cycle.
    """
''', '''def check(candidate):
    assert candidate(4, [(1, 0), (2, 0), (3, 1), (3, 2)]) == [3, 1, 2, 0]
    assert candidate(3, []) == [0, 1, 2]
    assert candidate(2, [(0, 1), (1, 0)]) == []
    assert candidate(5, [(4, 0), (3, 0), (0, 1), (2, 1)]) == [2, 3, 4, 0, 1]
    assert candidate(1, []) == [0]
''', '''    import heapq
    indeg = [0] * n; adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b); indeg[b] += 1
    h = [i for i in range(n) if indeg[i] == 0]; heapq.heapify(h); out = []
    while h:
        x = heapq.heappop(h); out.append(x)
        for y in adj[x]:
            indeg[y] -= 1
            if indeg[y] == 0:
                heapq.heappush(h, y)
    return out if len(out) == n else []
''')
