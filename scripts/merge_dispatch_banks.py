#!/usr/bin/env python3
"""Merge the three dispatch qualification JSON banks into one combined bank.

The three banks are produced by scripts/parse_dispatch_banks.py.  This merger
reads the validated JSON instead of the original workbooks so the combined
bank can be rebuilt without keeping the Excel files in the repository.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "app/assets/data"
AUDIT_DIR = ROOT / "sources/dispatch"
COMBINED_ID = "dispatchall"
COMBINED_TITLE = "调度业务联系资格培训题库·总题库"
COMBINED_FILE = "dispatch-all.json"
SOURCE_FILES = ("dispatch-basic.json", "dispatch-wind.json", "dispatch-pv.json")
TYPE_NAMES = {"single": "单选题", "multiple": "多选题", "judge": "判断题", "fill": "填空题"}


def question_signature(question: dict) -> tuple:
    return (
        question["type"],
        question["stem"],
        tuple((option["key"], option["text"]) for option in question["options"]),
        question["answer"],
    )


def build_combined_bank(banks: list[dict]) -> tuple[dict, dict]:
    questions: list[dict] = []
    chapters: list[str] = []
    types: Counter[str] = Counter()
    source_questions = 0
    for bank in banks:
        for question in bank["questions"]:
            source_questions += 1
            if question["chapter"] not in chapters:
                chapters.append(question["chapter"])
            types[question["type"]] += 1
            questions.append({
                **question,
                "id": f"{COMBINED_ID}-{len(questions) + 1:04d}",
                "number": len(questions) + 1,
                "sourceBank": bank["id"],
                "sourceQuestionId": question["id"],
            })
    duplicates = sum(count - 1 for count in Counter(question_signature(question) for question in questions).values() if count > 1)
    type_summary = "、".join(f"{TYPE_NAMES.get(type_id, type_id)}{count}" for type_id, count in types.items())
    bank = {
        "id": COMBINED_ID,
        "title": COMBINED_TITLE,
        "source": f"合并调度基础、风电、光伏三个调度业务联系资格培训题库，共{len(questions)}题（{type_summary}）",
        "questionCount": len(questions),
        "chapters": chapters,
        "questions": questions,
    }
    audit = {
        "bank": COMBINED_ID,
        "title": COMBINED_TITLE,
        "sourceBanks": [
            {"id": item["id"], "title": item["title"], "questions": item["questionCount"]}
            for item in banks
        ],
        "sourceQuestions": source_questions,
        "questions": len(questions),
        "types": dict(types),
        "chapters": chapters,
        "exactDuplicateQuestions": duplicates,
        "sourceFilesSha256": {
            name: hashlib.sha256((DATA_DIR / name).read_bytes()).hexdigest()
            for name in SOURCE_FILES
        },
    }
    return bank, audit


def main() -> None:
    banks = []
    for name in SOURCE_FILES:
        path = DATA_DIR / name
        if not path.is_file():
            raise SystemExit(f"Parsed bank not found: {path}. Run scripts/parse_dispatch_banks.py first.")
        banks.append(json.loads(path.read_text(encoding="utf-8")))
    expected_ids = ["dispatchbasic", "dispatchwind", "dispatchpv"]
    if [bank["id"] for bank in banks] != expected_ids:
        raise SystemExit(f"Unexpected source bank order: {[bank['id'] for bank in banks]}")
    combined, audit = build_combined_bank(banks)
    (DATA_DIR / COMBINED_FILE).write_text(
        json.dumps(combined, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    (AUDIT_DIR / "combined-audit.json").write_text(
        json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{COMBINED_FILE}: {combined['questionCount']} questions ({audit['types']})")
    if audit["exactDuplicateQuestions"]:
        print(f"Note: {audit['exactDuplicateQuestions']} exact duplicate questions were kept in source order.")


if __name__ == "__main__":
    main()
