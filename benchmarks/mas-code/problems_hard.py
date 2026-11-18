# Harder coding problems in HumanEval form: exact specs with many edge cases,
# performance limits, multi-step logic. Each has a reference solution.
P = []

def add(entry, prompt, test, ref):
    P.append({"entry_point": entry, "prompt": prompt, "test": test, "ref": ref})

add("justify", '''from typing import List


def justify(words: List[str], width: int) -> List[str]:
    """Fully justify text. Pack as many words as fit in each line (separated by at least one space).
    Spread the extra spaces between words as evenly as possible; when they do not divide evenly, the
    leftmost gaps get one more. A line with one word, and the last line, are left-justified: single
    spaces between words, padded with spaces on the right. Every line is exactly width characters.
    Every word is at most width long.
    """
''', '''def check(candidate):
    assert candidate(["This", "is", "an", "example", "of", "text", "justification."], 16) == ["This    is    an", "example  of text", "justification.  "]
    assert candidate(["What", "must", "be", "acknowledgment", "shall", "be"], 16) == ["What   must   be", "acknowledgment  ", "shall be        "]
    assert candidate(["Science", "is", "what", "we", "understand", "well", "enough", "to", "explain", "to", "a", "computer.", "Art", "is", "everything", "else", "we", "do"], 20) == [
        "Science  is  what we", "understand      well", "enough to explain to", "a  computer.  Art is", "everything  else  we", "do                  "]
    assert candidate(["a"], 1) == ["a"]
    assert candidate(["a", "b", "c", "d"], 3) == ["a b", "c d"]
    assert candidate(["ab", "c", "d", "efg"], 6) == ["ab c d", "efg   "]
''', '''    lines, cur, n = [], [], 0
    for w in words:
        if cur and n + len(cur) + len(w) > width:
            lines.append(cur); cur, n = [], 0
        cur.append(w); n += len(w)
    out = []
    for line in lines:
        if len(line) == 1:
            out.append(line[0].ljust(width)); continue
        gaps = len(line) - 1; spaces = width - sum(map(len, line))
        q, r = divmod(spaces, gaps)
        s = ""
        for i, w in enumerate(line[:-1]):
            s += w + " " * (q + (1 if i < r else 0))
        out.append(s + line[-1])
    out.append(" ".join(cur).ljust(width))
    return out
''')

add("parse_json", '''def parse_json(text: str):
    """Parse a JSON document into Python values (dict, list, str, int, float, True, False, None) without the json
    module. Support whitespace, nested objects and arrays, negative numbers, fractions and exponents (1.5e-3 is a
    float; numbers with no fraction or exponent are int), and string escapes \\\\" \\\\\\\\ \\\\/ \\\\n \\\\t \\\\uXXXX.
    Raise ValueError for invalid input, including trailing characters after the value.
    """
''', '''def check(candidate):
    import sys
    sys.modules["json"] = None
    assert candidate('{"a": [1, 2, {"b": null}], "c": true, "d": false}') == {"a": [1, 2, {"b": None}], "c": True, "d": False}
    assert candidate('  -12  ') == -12 and isinstance(candidate("-12"), int)
    assert candidate("1.5e-3") == 0.0015 and isinstance(candidate("2E2"), float)
    assert candidate('"a\\\\"b\\\\\\\\c\\\\/d\\\\ne\\\\u00e9"') == 'a"b\\\\c/d\\ne\\u00e9'
    assert candidate("[]") == [] and candidate("{}") == {}
    assert candidate('[[[]], {"x": {"y": [0.5]}}]') == [[[]], {"x": {"y": [0.5]}}]
    for bad in ['{"a": 1,}', "[1 2]", '{"a" 1}', "tru", '"abc', "1 2", "", "[1,]", "{1: 2}"]:
        try:
            candidate(bad)
        except ValueError:
            pass
        else:
            raise AssertionError("accepted " + repr(bad))
''', '''    i = 0
    n = len(text)
    def ws():
        nonlocal i
        while i < n and text[i] in " \\t\\n\\r":
            i += 1
    def val():
        nonlocal i
        ws()
        if i >= n:
            raise ValueError("end")
        c = text[i]
        if c == "{":
            i += 1; d = {}; ws()
            if i < n and text[i] == "}":
                i += 1; return d
            while True:
                ws()
                if i >= n or text[i] != '"':
                    raise ValueError("key")
                k = string(); ws()
                if i >= n or text[i] != ":":
                    raise ValueError(":")
                i += 1; d[k] = val(); ws()
                if i < n and text[i] == ",":
                    i += 1; continue
                if i < n and text[i] == "}":
                    i += 1; return d
                raise ValueError("obj")
        if c == "[":
            i += 1; a = []; ws()
            if i < n and text[i] == "]":
                i += 1; return a
            while True:
                a.append(val()); ws()
                if i < n and text[i] == ",":
                    i += 1; continue
                if i < n and text[i] == "]":
                    i += 1; return a
                raise ValueError("arr")
        if c == '"':
            return string()
        for lit, v in (("true", True), ("false", False), ("null", None)):
            if text.startswith(lit, i):
                i += len(lit); return v
        return number()
    def string():
        nonlocal i
        i += 1; s = []
        while True:
            if i >= n:
                raise ValueError("unterminated")
            c = text[i]
            if c == '"':
                i += 1; return "".join(s)
            if c == "\\\\":
                i += 1
                if i >= n:
                    raise ValueError("esc")
                e = text[i]
                if e == "u":
                    h = text[i + 1:i + 5]
                    if len(h) != 4 or any(x not in "0123456789abcdefABCDEF" for x in h):
                        raise ValueError("u")
                    s.append(chr(int(h, 16))); i += 5; continue
                m = {'"': '"', "\\\\": "\\\\", "/": "/", "n": "\\n", "t": "\\t", "b": "\\b", "f": "\\f", "r": "\\r"}
                if e not in m:
                    raise ValueError("esc")
                s.append(m[e]); i += 1; continue
            s.append(c); i += 1
    def number():
        nonlocal i
        j = i
        if i < n and text[i] == "-":
            i += 1
        if i >= n or not text[i].isdigit():
            raise ValueError("num")
        while i < n and text[i].isdigit():
            i += 1
        isf = False
        if i < n and text[i] == ".":
            isf = True; i += 1
            if i >= n or not text[i].isdigit():
                raise ValueError("frac")
            while i < n and text[i].isdigit():
                i += 1
        if i < n and text[i] in "eE":
            isf = True; i += 1
            if i < n and text[i] in "+-":
                i += 1
            if i >= n or not text[i].isdigit():
                raise ValueError("exp")
            while i < n and text[i].isdigit():
                i += 1
        t = text[j:i]
        return float(t) if isf else int(t)
    v = val(); ws()
    if i != n:
        raise ValueError("trailing")
    return v
''')

add("skyline", '''from typing import List


def skyline(buildings: List[List[int]]) -> List[List[int]]:
    """The skyline of rectangular buildings [left, right, height] on flat ground: the key points [x, height]
    where the outline's height changes, sorted by x, ending with a point at height 0. No two consecutive
    points have the same height. Up to 10,000 buildings.
    """
''', '''def check(candidate):
    assert candidate([[2, 9, 10], [3, 7, 15], [5, 12, 12], [15, 20, 10], [19, 24, 8]]) == [[2, 10], [3, 15], [7, 12], [12, 0], [15, 10], [20, 8], [24, 0]]
    assert candidate([[0, 2, 3], [2, 5, 3]]) == [[0, 3], [5, 0]]
    assert candidate([[1, 2, 1], [1, 2, 2], [1, 2, 3]]) == [[1, 3], [2, 0]]
    assert candidate([]) == []
    assert candidate([[0, 5, 2], [1, 3, 2]]) == [[0, 2], [5, 0]]
    import random, time
    rnd = random.Random(3)
    bs = []
    for _ in range(10000):
        l = rnd.randrange(0, 10**6); bs.append([l, l + rnd.randrange(1, 5000), rnd.randrange(1, 1000)])
    t = time.time(); out = candidate(bs)
    assert time.time() - t < 4, "too slow"
    assert out[-1][1] == 0 and all(a[0] < b[0] and a[1] != b[1] for a, b in zip(out, out[1:]))
''', '''    import heapq
    events = sorted([(l, -h, r) for l, r, h in buildings] + [(r, 0, 0) for l, r, h in buildings])
    out = []; live = [(0, float("inf"))]
    for x, negh, r in events:
        while live[0][1] <= x:
            heapq.heappop(live)
        if negh:
            heapq.heappush(live, (negh, r))
        h = -live[0][0]
        if not out or out[-1][1] != h:
            if out and out[-1][0] == x:
                out[-1][1] = h
                if len(out) > 1 and out[-2][1] == h:
                    out.pop()
            else:
                out.append([x, h])
    return out
''')

add("trap_rain_2d", '''from typing import List


def trap_rain_2d(heights: List[List[int]]) -> int:
    """Water trapped on a 2D elevation map after rain (water flows off the edges; cells connect up, down,
    left, right). The map can be 200x200.
    """
''', '''def check(candidate):
    assert candidate([[1, 4, 3, 1, 3, 2], [3, 2, 1, 3, 2, 4], [2, 3, 3, 2, 3, 1]]) == 4
    assert candidate([[3, 3, 3, 3, 3], [3, 2, 2, 2, 3], [3, 2, 1, 2, 3], [3, 2, 2, 2, 3], [3, 3, 3, 3, 3]]) == 10
    assert candidate([]) == 0
    assert candidate([[5]]) == 0
    assert candidate([[12, 13, 1, 12], [13, 4, 13, 12], [13, 8, 10, 12], [12, 13, 12, 12], [13, 13, 13, 13]]) == 14
    big = [[9] * 200] + [[9] + [0] * 198 + [9] for _ in range(198)] + [[9] * 200]
    assert candidate(big) == 9 * 198 * 198
''', '''    import heapq
    if not heights or not heights[0]:
        return 0
    R, C = len(heights), len(heights[0])
    seen = [[False] * C for _ in range(R)]; h = []
    for r in range(R):
        for c in range(C):
            if r in (0, R - 1) or c in (0, C - 1):
                heapq.heappush(h, (heights[r][c], r, c)); seen[r][c] = True
    water = 0
    while h:
        v, r, c = heapq.heappop(h)
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = r + dr, c + dc
            if 0 <= a < R and 0 <= b < C and not seen[a][b]:
                seen[a][b] = True
                water += max(0, v - heights[a][b])
                heapq.heappush(h, (max(v, heights[a][b]), a, b))
    return water
''')

add("regex_match", '''def regex_match(s: str, p: str) -> bool:
    """Whether the whole of s matches pattern p, where '.' is any one character, '*' means zero or more of the
    element before it, '+' one or more of it, and '?' zero or one of it. Everything else is literal. Do not use the re module.
    """
''', '''def check(candidate):
    import sys
    sys.modules["re"] = None
    assert candidate("aa", "a") is False
    assert candidate("aa", "a*") is True
    assert candidate("ab", ".*") is True
    assert candidate("aab", "c*a*b") is True
    assert candidate("mississippi", "mis*is*p*.") is False
    assert candidate("", "a*b?") is True
    assert candidate("", "a+") is False
    assert candidate("aaa", "a+") is True
    assert candidate("ac", "ab?c") is True
    assert candidate("abbc", "ab?c") is False
    assert candidate("abcd", "a.+d") is True
    assert candidate("ad", "a.+d") is False
    assert candidate("a" * 30 + "b", "a*a*a*a*a*a*a*a*c") is False
''', '''    from functools import lru_cache
    @lru_cache(None)
    def m(i, j):
        if j == len(p):
            return i == len(s)
        first = i < len(s) and p[j] in (s[i], ".")
        if j + 1 < len(p) and p[j + 1] in "*+?":
            q = p[j + 1]
            if q == "*":
                return m(i, j + 2) or (first and m(i + 1, j))
            if q == "+":
                return first and (m(i + 1, j + 2) or m(i + 1, j))
            return m(i, j + 2) or (first and m(i + 1, j + 2))
        return first and m(i + 1, j + 1)
    return m(0, 0)
''')

add("run_program", '''from typing import List


def run_program(lines: List[str]) -> dict:
    """Run a tiny register machine and return its registers (a dict of name to int; registers start at 0 and
    only those ever written appear). Instructions, one per line:
      set X Y   X = Y        add X Y   X += Y       mul X Y   X *= Y
      mod X Y   X = X % Y (Python %)                jnz X Y   if X != 0, jump by Y lines (relative)
    Y can be a register name or an integer literal (possibly negative); X in jnz can be either too.
    Blank lines and anything after '#' are ignored, and do not count as lines for jumps.
    The program ends when it jumps or steps outside the program. Stop with RuntimeError after 1,000,000 steps.
    """
''', '''def check(candidate):
    prog = ["set a 5", "set b 1", "mul b a", "add a -1", "jnz a -2"]
    assert candidate(prog) == {"a": 0, "b": 120}
    assert candidate(["set x 7  # seven", "", "mod x 3", "jnz 1 2", "set x 100", "add y x"]) == {"x": 1, "y": 1}
    assert candidate(["set a -7", "mod a 3"]) == {"a": 2}
    assert candidate(["jnz 0 5", "add z 2"]) == {"z": 2}
    assert candidate([]) == {}
    try:
        candidate(["set a 1", "jnz a 0"])
    except RuntimeError:
        pass
    else:
        raise AssertionError("no RuntimeError on an endless loop")
    big = ["set n 300000", "add s n", "add n -1", "jnz n -2"]
    assert candidate(big)["s"] == 300000 * 300001 // 2
''', '''    prog = []
    for l in lines:
        l = l.split("#", 1)[0].strip()
        if l:
            prog.append(l.split())
    reg = {}
    def v(t):
        try:
            return int(t)
        except ValueError:
            return reg.get(t, 0)
    pc = steps = 0
    while 0 <= pc < len(prog):
        steps += 1
        if steps > 1_000_000:
            raise RuntimeError("too many steps")
        op, x, y = prog[pc]
        if op == "jnz":
            pc += v(y) if v(x) != 0 else 1
            continue
        if op == "set": reg[x] = v(y)
        elif op == "add": reg[x] = reg.get(x, 0) + v(y)
        elif op == "mul": reg[x] = reg.get(x, 0) * v(y)
        elif op == "mod": reg[x] = reg.get(x, 0) % v(y)
        pc += 1
    return reg
''')

add("multiply_strings", '''def multiply_strings(a: str, b: str) -> str:
    """Multiply two non-negative integers given as decimal strings (up to 2,000 digits, maybe with leading
    zeros) and return the product as a string with no leading zeros ("0" for zero). Do not convert the whole
    inputs to int: work digit by digit.
    """
''', '''def check(candidate):
    import random, sys
    rnd = random.Random(1)
    x = "".join(rnd.choice("0123456789") for _ in range(2000)); y = "".join(rnd.choice("0123456789") for _ in range(1500))
    # converting a long digit string to int (or back) raises ValueError while this limit is set
    sys.set_int_max_str_digits(640)
    try:
        assert candidate("2", "3") == "6"
        assert candidate("123", "456") == "56088"
        assert candidate("0", "9999") == "0"
        assert candidate("000", "0012") == "0"
        assert candidate("0099", "0011") == "1089"
        got = candidate(x, y)
    finally:
        sys.set_int_max_str_digits(0)
    assert got == str(int(x) * int(y))
''', '''    a = a.lstrip("0") or "0"; b = b.lstrip("0") or "0"
    if a == "0" or b == "0":
        return "0"
    res = [0] * (len(a) + len(b))
    for i in range(len(a) - 1, -1, -1):
        da = ord(a[i]) - 48
        for j in range(len(b) - 1, -1, -1):
            res[i + j + 1] += da * (ord(b[j]) - 48)
    for k in range(len(res) - 1, 0, -1):
        res[k - 1] += res[k] // 10; res[k] %= 10
    s = "".join(chr(48 + d) for d in res).lstrip("0")
    return s or "0"
''')

add("count_smaller_after", '''from typing import List


def count_smaller_after(nums: List[int]) -> List[int]:
    """For each element, how many elements to its right are strictly smaller. nums has up to 100,000 elements:
    a quadratic solution is too slow.
    """
''', '''def check(candidate):
    assert candidate([5, 2, 6, 1]) == [2, 1, 1, 0]
    assert candidate([-1]) == [0]
    assert candidate([-1, -1]) == [0, 0]
    assert candidate([]) == []
    assert candidate([3, 3, 1, 2, 3]) == [2, 2, 0, 0, 0]
    import random, time
    rnd = random.Random(5)
    xs = [rnd.randrange(-10**9, 10**9) for _ in range(100000)]
    t = time.time(); out = candidate(xs)
    assert time.time() - t < 5, "too slow"
    assert out[-1] == 0 and out[0] == sum(1 for v in xs[1:] if v < xs[0]) and len(out) == len(xs)
    assert candidate(list(range(100000, 0, -1)))[:3] == [99999, 99998, 99997]
''', '''    rank = {v: i + 1 for i, v in enumerate(sorted(set(nums)))}
    tree = [0] * (len(rank) + 1); out = []
    for v in reversed(nums):
        r = rank[v] - 1; c = 0
        while r > 0:
            c += tree[r]; r -= r & -r
        out.append(c)
        r = rank[v]
        while r < len(tree):
            tree[r] += 1; r += r & -r
    return out[::-1]
''')

add("sliding_puzzle", '''from typing import List


def sliding_puzzle(board: List[List[int]]) -> int:
    """The fewest moves to solve a 2x3 sliding puzzle (tiles 1-5 and the empty square 0; a move slides a tile
    next to 0 into it, not diagonally) into [[1, 2, 3], [4, 5, 0]], or -1 if it cannot be solved.
    """
''', '''def check(candidate):
    assert candidate([[1, 2, 3], [4, 0, 5]]) == 1
    assert candidate([[1, 2, 3], [5, 4, 0]]) == -1
    assert candidate([[4, 1, 2], [5, 0, 3]]) == 5
    assert candidate([[3, 2, 4], [1, 5, 0]]) == 14
    assert candidate([[1, 2, 3], [4, 5, 0]]) == 0
''', '''    from collections import deque
    start = "".join(str(x) for row in board for x in row)
    nb = {0: (1, 3), 1: (0, 2, 4), 2: (1, 5), 3: (0, 4), 4: (1, 3, 5), 5: (2, 4)}
    seen = {start}; q = deque([(start, 0)])
    while q:
        s, d = q.popleft()
        if s == "123450":
            return d
        z = s.index("0")
        for k in nb[z]:
            t = list(s); t[z], t[k] = t[k], t[z]; t = "".join(t)
            if t not in seen:
                seen.add(t); q.append((t, d + 1))
    return -1
''')

add("edit_script", '''from typing import List


def edit_script(a: str, b: str) -> List[str]:
    """A shortest list of single-character edits turning a into b (Levenshtein: insert, delete, substitute).
    Each edit is a string: "ins i c" (insert c before position i), "del i" (delete position i), or "sub i c"
    (replace position i with c), where positions refer to the string as it is when that edit is applied, edits
    applied in order. Any shortest script is accepted. a and b are up to 500 characters.
    """
''', '''def check(candidate):
    def lev(x, y):
        prev = list(range(len(y) + 1))
        for i in range(1, len(x) + 1):
            cur = [i] + [0] * len(y)
            for j in range(1, len(y) + 1):
                cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] != y[j - 1]))
            prev = cur
        return prev[-1]
    def apply(s, script):
        s = list(s)
        for e in script:
            parts = e.split(" ")
            if parts[0] == "ins":
                s.insert(int(parts[1]), parts[2])
            elif parts[0] == "del":
                del s[int(parts[1])]
            elif parts[0] == "sub":
                s[int(parts[1])] = parts[2]
            else:
                raise AssertionError("bad edit " + e)
        return "".join(s)
    import random
    rnd = random.Random(9)
    pairs = [("kitten", "sitting"), ("", "abc"), ("abc", ""), ("same", "same"), ("intention", "execution")]
    pairs.append(("".join(rnd.choice("abcd") for _ in range(400)), "".join(rnd.choice("abcd") for _ in range(380))))
    for x, y in pairs:
        sc = candidate(x, y)
        assert apply(x, sc) == y, (x, y)
        assert len(sc) == lev(x, y), (x, y, len(sc), lev(x, y))
''', '''    n, m = len(a), len(b)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] != b[j - 1]))
    ops = []; i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and a[i - 1] == b[j - 1] and d[i][j] == d[i - 1][j - 1]:
            i -= 1; j -= 1
        elif i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + 1:
            ops.append(("sub", i - 1, b[j - 1])); i -= 1; j -= 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            ops.append(("del", i - 1)); i -= 1
        else:
            ops.append(("ins", i, b[j - 1])); j -= 1
    # ops run from the end of the string backwards, so earlier positions are unaffected
    return [f"{o[0]} {o[1]}" + (f" {o[2]}" if len(o) > 2 else "") for o in ops]
''')

add("median_sorted", '''from typing import List


def median_sorted(a: List[int], b: List[int]) -> float:
    """The median of the union of two sorted lists (as a float), in O(log(min(m, n))) time.
    The lists can hold 1,000,000 elements each; at least one is non-empty. Do not merge or concatenate them.
    """
''', '''def check(candidate):
    assert candidate([1, 3], [2]) == 2.0
    assert candidate([1, 2], [3, 4]) == 2.5
    assert candidate([], [1]) == 1.0
    assert candidate([2], []) == 2.0
    assert candidate([1, 1, 1], [1, 1]) == 1.0
    assert candidate([1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11]) == 6.0
    import time
    a = list(range(0, 2000000, 2)); b = list(range(1, 2000001, 2))
    class Spy(list):
        def __add__(self, o):
            raise AssertionError("concatenated the lists")
        def __iter__(self):
            raise AssertionError("iterated over a whole list")
    t = time.time()
    assert candidate(Spy(a), Spy(b)) == 999999.5
    assert time.time() - t < 1, "too slow"
''', '''    if len(a) > len(b):
        a, b = b, a
    m, n = len(a), len(b)
    lo, hi, half = 0, m, (m + n + 1) // 2
    INF = float("inf")
    while lo <= hi:
        i = (lo + hi) // 2; j = half - i
        al = a[i - 1] if i > 0 else -INF; ar = a[i] if i < m else INF
        bl = b[j - 1] if j > 0 else -INF; br = b[j] if j < n else INF
        if al <= br and bl <= ar:
            if (m + n) % 2:
                return float(max(al, bl))
            return (max(al, bl) + min(ar, br)) / 2
        if al > br:
            hi = i - 1
        else:
            lo = i + 1
''')

add("schedule_meetings", '''from typing import List, Tuple


def schedule_meetings(busy: List[List[Tuple[str, str]]], duration: int, day: Tuple[str, str]) -> str:
    """The earliest start time "HH:MM" when every person is free for duration minutes within working hours
    day = (start, end). busy[p] lists person p's busy (start, end) intervals as "HH:MM", unsorted, possibly
    overlapping; a meeting may start exactly when a busy interval ends and must end by day's end.
    Return "" if there is no such time.
    """
''', '''def check(candidate):
    busy = [[("09:00", "10:30"), ("12:00", "13:00")], [("10:00", "11:00"), ("13:30", "14:00")]]
    assert candidate(busy, 30, ("09:00", "17:00")) == "11:00"
    assert candidate(busy, 60, ("09:00", "17:00")) == "11:00"
    assert candidate(busy, 70, ("09:00", "17:00")) == "14:00"
    assert candidate([[("09:00", "17:00")]], 1, ("09:00", "17:00")) == ""
    assert candidate([[], []], 480, ("09:00", "17:00")) == "09:00"
    assert candidate([[], []], 481, ("09:00", "17:00")) == ""
    assert candidate([[("08:00", "09:15")], [("09:10", "09:20"), ("09:15", "09:40")]], 20, ("09:00", "10:00")) == "09:40"
    assert candidate([[("16:30", "18:00")]], 30, ("09:00", "17:00")) == "09:00"
    assert candidate([[("09:00", "16:40")]], 30, ("09:00", "17:00")) == ""
''', '''    def t(s):
        h, m = s.split(":"); return int(h) * 60 + int(m)
    start, end = t(day[0]), t(day[1])
    iv = sorted((t(a), t(b)) for person in busy for a, b in person)
    cur = start
    for a, b in iv:
        if a - cur >= duration and cur + duration <= end:
            break
        cur = max(cur, b)
    if cur + duration > end:
        return ""
    return f"{cur // 60:02d}:{cur % 60:02d}"
''')
