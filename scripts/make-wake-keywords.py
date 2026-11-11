#!/usr/bin/env python3
"""Create sherpa-onnx BPE keyword tokens for Buddy's custom wake phrase."""
from pathlib import Path
import sys
import sentencepiece as spm

if len(sys.argv) != 3:
    raise SystemExit("Usage: make-wake-keywords.py <bpe.model> <keywords.txt>")

model_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
processor = spm.SentencePieceProcessor(model_file=str(model_path))
tokens = processor.encode("HEY BUDDY", out_type=str)
if not tokens:
    raise SystemExit("SentencePiece produced no tokens for HEY BUDDY.")

output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(" ".join(tokens) + " @HEY_BUDDY\n", encoding="utf-8")
print("Generated Hey Buddy keyword tokens:", output_path.read_text(encoding="utf-8").strip())
