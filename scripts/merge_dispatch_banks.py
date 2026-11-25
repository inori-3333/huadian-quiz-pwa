#!/usr/bin/env python3
"""Merge the dispatch qualification JSON banks into the combined banks.

The three source banks are produced by scripts/parse_dispatch_banks.py.  This
script reads the validated JSON instead of the original workbooks so every
combined bank can be rebuilt without keeping the Excel files in the repository.

It writes three banks:

* ``dispatch-all``        — basic + wind + PV
* ``dispatch-basic-wind`` — basic + wind
* ``dispatch-basic-pv``   — basic + PV
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "app/assets/data"
AUDIT_DIR = ROOT / "sources/dispatch"
SOURCE_FILES = ("dispatch-basic.json", "dispatch-wind.json", "dispatch-pv.json")
SOURCE_ID_FILES = {
    "dispatchbasic": "dispatch-basic.json",
    "dispatchwind": "dispatch-wind.json",
    "dispatchpv": "dispatch-pv.json",
}
TYPE_NAMES = {"single": "单选题", "multiple": "多选题", "judge": "判断题", "fill": "填空题"}


@dataclass(frozen=True)
class CombinedBankSpec:
    id: str
    title: str
    file: str
    audit_file: str
    source_ids: tuple[str, ...]
    origin_phrase: str


COMBINED_BANKS = (
    CombinedBankSpec(
        id="dispatchbasicwind",
        title="调度业务联系资格培训题库·调度基础+风电",
        file="dispatch-basic-wind.json",
        audit_file="combined-basic-wind-audit.json",
        source_ids=("dispatchbasic", "dispatchwind"),
        origin_phrase="调度基础、风电两个",
    ),
    CombinedBankSpec(
        id="dispatchbasicpv",
        title="调度业务联系资格培训题库·调度基础+光伏",
        file="dispatch-basic-pv.json",
        audit_file="combined-basic-pv-audit.json",
        source_ids=("dispatchbasic", "dispatchpv"),
        origin_phrase="调度基础、光伏两个",
    ),
    CombinedBankSpec(
        id="dispatchall",
        title="调度业务联系资格培训题库·总题库",
        file="dispatch-all.json",
        audit_file="combined-audit.json",
        source_ids=("dispatchbasic", "dispatchwind", "dispatchpv"),
        origin_phrase="调度基础、风电、光伏三个",
    ),
)


def question_signature(question: dict) -> tuple:
    return (
        question["type"],
        question["stem"],
        tuple((option["key"], option["text"]) for option in question["options"]),
        question["answer"],
    )


def build_combined_bank(banks: dict[str, dict], spec: CombinedBankSpec) -> tuple[dict, dict]:
    selected = [banks[bank_id] for bank_id in spec.source_ids]
    questions: list[dict] = []
    chapters: list[str] = []
    types: Counter[str] = Counter()
    source_questions = 0
    for bank in selected:
        for question in bank["questions"]:
            source_questions += 1
            if question["chapter"] not in chapters:
                chapters.append(question["chapter"])
            types[question["type"]] += 1
            questions.append({
                **question,
                "id": f"{spec.id}-{len(questions) + 1:04d}",
                "number": len(questions) + 1,
                "sourceBank": bank["id"],
                "sourceQuestionId": question["id"],
            })
    duplicates = sum(count - 1 for count in Counter(question_signature(question) for question in questions).values() if count > 1)
    type_summary = "、".join(f"{TYPE_NAMES.get(type_id, type_id)}{count}" for type_id, count in types.items())
    bank = {
        "id": spec.id,
        "title": spec.title,
        "source": f"合并{spec.origin_phrase}调度业务联系资格培训题库，共{len(questions)}题（{type_summary}）",
        "questionCount": len(questions),
        "chapters": chapters,
        "questions": questions,
    }
    audit = {
        "bank": spec.id,
        "title": spec.title,
        "sourceBanks": [
            {"id": item["id"], "title": item["title"], "questions": item["questionCount"]}
            for item in selected
        ],
        "sourceQuestions": source_questions,
        "questions": len(questions),
        "types": dict(types),
        "chapters": chapters,
        "exactDuplicateQuestions": duplicates,
        "sourceFilesSha256": {
            name: hashlib.sha256((DATA_DIR / name).read_bytes()).hexdigest()
            for name in (SOURCE_ID_FILES[bank_id] for bank_id in spec.source_ids)
        },
    }
    return bank, audit


def main() -> None:
    banks: dict[str, dict] = {}
    for name in SOURCE_FILES:
        path = DATA_DIR / name
        if not path.is_file():
            raise SystemExit(f"Parsed bank not found: {path}. Run scripts/parse_dispatch_banks.py first.")
        bank = json.loads(path.read_text(encoding="utf-8"))
        banks[bank["id"]] = bank
    expected_ids = ["dispatchbasic", "dispatchwind", "dispatchpv"]
    if sorted(banks) != sorted(expected_ids):
        raise SystemExit(f"Unexpected source bank ids: {sorted(banks)}")

    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    for spec in COMBINED_BANKS:
        combined, audit = build_combined_bank(banks, spec)
        (DATA_DIR / spec.file).write_text(
            json.dumps(combined, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
        )
        (AUDIT_DIR / spec.audit_file).write_text(
            json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"{spec.file}: {combined['questionCount']} questions ({audit['types']})")
        if audit["exactDuplicateQuestions"]:
            print(f"Note: {audit['exactDuplicateQuestions']} exact duplicate questions were kept in source order.")


if __name__ == "__main__":
    main()
