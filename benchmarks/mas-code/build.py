import json, os, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from problems import P
ok = True
for i, p in enumerate(P):
    prog = p["prompt"] + p["ref"] + "\n\n" + p["test"] + f"\ncheck({p['entry_point']})\n"
    d = tempfile.mkdtemp(); open(os.path.join(d, "prog.py"), "w").write(prog); os.chmod(d, 0o755)
    r = subprocess.run(["docker", "run", "--rm", "--network", "none", "--memory", "512m", "--cpus", "1", "--pids-limit", "128", "--read-only", "--tmpfs", "/tmp", "-v", f"{d}:/work:ro", "python:3.12-slim", "timeout", "10", "python", "/work/prog.py"], capture_output=True, text=True)
    print(f"{i+1:2} {p['entry_point']:28} {'ok' if r.returncode == 0 else 'FAIL ' + (r.stderr.strip().splitlines() or ['?'])[-1][:120]}")
    ok &= r.returncode == 0
if ok:
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mas-code-19.jsonl"), "w") as f:
        for i, p in enumerate(P):
            f.write(json.dumps({"task_id": f"MasCode/{i}", "prompt": p["prompt"], "test": p["test"], "entry_point": p["entry_point"]}) + "\n")
    print("wrote", len(P))
