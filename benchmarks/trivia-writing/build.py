"""Trivia Creative Writing in the form of Solo Performance Prompting (Wang et al. 2024): write a short story on a
topic that works in the answers to N trivia questions. Twenty tasks of five questions, written for this project from
well-known facts with one clear answer each (aliases listed). Every answer is a name or a specific term, never a
number or a common word that a story would use anyway ("two", "heart"). Usage: python3 build.py > trivia-writing-20.jsonl
"""
import json, random

Q = [
    ("What is the largest planet in the Solar System?", ["Jupiter"]),
    ("What is the chemical symbol for gold?", ["Au"]),
    ("Who wrote the play Romeo and Juliet?", ["Shakespeare"]),
    ("What is the capital city of Japan?", ["Tokyo"]),
    ("Who painted the Mona Lisa?", ["Leonardo", "da Vinci"]),
    ("What is the longest river in South America?", ["Amazon"]),
    ("Which planet is known as the Red Planet?", ["Mars"]),
    ("In which country are the ancient pyramids of Giza?", ["Egypt"]),
    ("Who developed the theory of general relativity?", ["Einstein"]),
    ("What is the largest ocean on Earth?", ["Pacific"]),
    ("What is the capital city of France?", ["Paris"]),
    ("What is the main language spoken in Brazil?", ["Portuguese"]),
    ("Who was the first person to walk on the Moon?", ["Armstrong"]),
    ("What is the tallest mountain on Earth?", ["Everest"]),
    ("Who composed the Fifth Symphony that opens with four famous notes?", ["Beethoven"]),
    ("Which planet has the most prominent rings?", ["Saturn"]),
    ("What is the largest desert in the world by area, including polar deserts?", ["Antarctic", "Antarctica"]),
    ("Who wrote the novel Pride and Prejudice?", ["Austen"]),
    ("What is the capital city of Italy?", ["Rome"]),
    ("Which element has the chemical symbol O?", ["oxygen"]),
    ("Which country gifted the Statue of Liberty to the United States?", ["France", "French"]),
    ("What is the largest mammal on Earth?", ["blue whale"]),
    ("Which famous ship sank on its maiden voyage in 1912?", ["Titanic"]),
    ("What is the national flower of Japan, famous for spring blossoms?", ["cherry blossom", "sakura"]),
    ("What is the capital city of Australia?", ["Canberra"]),
]
TOPICS = ["a lighthouse keeper", "a lost cat", "a summer storm", "a village bakery", "a train journey", "a museum at night",
          "a chess tournament", "a mountain rescue", "a school science fair", "a desert caravan", "a robot gardener",
          "a pirate's map", "a winter festival", "an old violin", "a space station", "a detective's rainy day",
          "a family reunion", "a forgotten library", "a circus act", "a midnight snack"]
rng = random.Random(0)
for topic in TOPICS:
    picks = rng.sample(Q, 5)
    qs = " ".join(f"{i + 1}. {q}" for i, (q, _) in enumerate(picks))
    print(json.dumps({"input": f"Write a short and coherent story about {topic} that incorporates the answers to the following 5 questions: {qs}",
                      "expected": json.dumps([a for _, a in picks])}))
