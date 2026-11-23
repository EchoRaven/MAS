"""Solo Performance Prompting's own Trivia Creative Writing set (N = 5) in this platform's form.

The set is not bundled (its repository has no license); download it first:
  https://raw.githubusercontent.com/MikeWangWZHL/Solo-Performance-Prompting/main/data/trivia_creative_writing/trivia_creative_writing_100_n_5.jsonl
Its questions come from TriviaQA; each record has a topic, five questions and each answer's aliases.
Usage: python3 from_spp.py trivia_creative_writing_100_n_5.jsonl > spp-trivia-100.jsonl
Grade with check.js, as the generated set.
"""
import json, sys

for line in open(sys.argv[1]):
    r = json.loads(line)
    qs = " ".join(f"{i + 1}. {q}" for i, q in enumerate(r["questions"]))
    n = len(r["questions"])
    print(json.dumps({"input": f"Write a short and coherent story about {r['topic']} that incorporates the answers to the following {n} questions: {qs}",
                      "expected": json.dumps(r["answers"])}))
