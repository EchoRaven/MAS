# LiveCodeBench, competitive programming

Recent contest problems with hidden tests, from LiveCodeBench's `code_generation_lite` (release 6: January to April
2025), for systems on a model strong enough to solve every set bundled here. Not bundled; download the release and
convert it (see `convert.py`): AtCoder's hard problems are stdin programs, graded by `code` with stdin/stdout tests
(the code spec's `io`), each run in the Docker sandbox with 6 seconds a test. The hidden tests are read with an
unpickler that refuses every class, so no code in the file can run.
