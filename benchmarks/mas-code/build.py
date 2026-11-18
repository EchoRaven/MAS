"""Check every reference solution against its tests in the Docker sandbox the grader uses, then write the JSON lines.
    python3 -I build.py                  # problems.py      -> mas-code-19.jsonl
    python3 -I build.py problems_hard    # problems_hard.py -> mas-code-hard-12.jsonl
"""
import importlib, json, os, subprocess, sys, tempfile
here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
mod = sys.argv[1] if len(sys.argv) > 1 else "problems"
P = importlib.import_module(mod).P
out_name = {"problems": "mas-code-19.jsonl", "problems_hard": f"mas-code-hard-{len(P)}.jsonl"}[mod]
ok = True
for i, p in enumerate(P):
    prog = p["prompt"] + p["ref"] + "\n\n" + p["test"] + f"\ncheck({p['entry_point']})\n"
    d = tempfile.mkdtemp(); open(os.path.join(d, "prog.py"), "w").write(prog); os.chmod(d, 0o755)
    r = subprocess.run(["docker", "run", "--rm", "--network", "none", "--memory", "512m", "--cpus", "1", "--pids-limit", "128", "--read-only", "--tmpfs", "/tmp", "-v", f"{d}:/work:ro", "python:3.12-slim", "timeout", "10", "python", "/work/prog.py"], capture_output=True, text=True)
    print(f"{i+1:2} {p['entry_point']:28} {'ok' if r.returncode == 0 else 'FAIL ' + (r.stderr.strip().splitlines() or ['exit ' + str(r.returncode)])[-1][:160]}")
    ok &= r.returncode == 0
if ok:
    prefix = "MasCode" if mod == "problems" else "MasCodeHard"
    with open(os.path.join(here, out_name), "w") as f:
        for i, p in enumerate(P):
            f.write(json.dumps({"task_id": f"{prefix}/{i}", "prompt": p["prompt"], "test": p["test"], "entry_point": p["entry_point"]}) + "\n")
    print("wrote", out_name)
else:
    print("not written: fix the failures first")
