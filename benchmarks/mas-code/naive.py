import os, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from problems_hard import P
naive = {
 "multiply_strings": "    return str(int(a) * int(b))\n",
 "median_sorted": "    c = sorted(a + b); n = len(c)\n    return float(c[n//2]) if n % 2 else (c[n//2-1] + c[n//2]) / 2\n",
 "count_smaller_after": "    return [sum(1 for w in nums[i+1:] if w < v) for i, v in enumerate(nums)]\n",
 "regex_match": "    import re\n    return re.fullmatch(p, s) is not None\n",
 "parse_json": "    import json\n    return json.loads(text)\n",
}
for p in P:
    if p["entry_point"] not in naive: continue
    prog = p["prompt"] + naive[p["entry_point"]] + "\n\n" + p["test"] + f"\ncheck({p['entry_point']})\n"
    d = tempfile.mkdtemp(); open(os.path.join(d, "prog.py"), "w").write(prog); os.chmod(d, 0o755)
    r = subprocess.run(["docker", "run", "--rm", "--network", "none", "--memory", "512m", "--cpus", "1", "--read-only", "--tmpfs", "/tmp", "-v", f"{d}:/work:ro", "python:3.12-slim", "timeout", "10", "python", "/work/prog.py"], capture_output=True, text=True)
    print(f"{p['entry_point']:22} naive {'PASSES (test too weak!)' if r.returncode == 0 else 'rejected: ' + ((r.stderr.strip().splitlines() or ['timeout ' + str(r.returncode)])[-1][:90])}")
