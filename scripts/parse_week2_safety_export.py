#!/usr/bin/env python3
"""Convert the artifact-tool JSON export of the week-2 workbook into an app bank."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path


EXPECTED_HEADER = ["序号", "题型", "题干", "答案"]
TYPE_MAP = {"选择题": "single", "填空题": "fill", "判断题": "judge"}
EXPECTED_COUNTS = Counter({"选择题": 89, "填空题": 90, "判断题": 90})
OPTION_MARKER_RE = re.compile(r"(?<![A-Za-z])([A-D])(?:[.．、:：）)]|\s+)")


def clean(value: object) -> str:
    return re.sub(r"[\s　]+", " ", str(value or "")).strip()


def split_choice(value: object) -> tuple[str, list[dict[str, str]]]:
    text = clean(value)
    candidates = list(OPTION_MARKER_RE.finditer(text))
    selected = []
    cursor = 0
    for key in "ABCD":
        match = next((item for item in candidates[cursor:] if item.group(1) == key), None)
        if match is None:
            raise ValueError(f"missing option {key}: {text}")
        selected.append(match)
        cursor = candidates.index(match) + 1
    if [item.group(1) for item in selected] != list("ABCD"):
        raise ValueError(f"unexpected option sequence: {text}")

    stem = text[: selected[0].start()].strip(' "“”')
    options = []
    for index, match in enumerate(selected):
        end = selected[index + 1].start() if index + 1 < len(selected) else len(text)
        option_text = text[match.end() : end].strip(" \t\r\n;；。")
        if not option_text:
            raise ValueError(f"empty option {match.group(1)}: {text}")
        options.append({"key": match.group(1), "text": option_text})
    if not stem:
        raise ValueError(f"empty choice stem: {text}")
    return stem, options


def normalize_judge(value: object) -> str:
    answer = clean(value)
    if answer in {"对", "正确", "√", "✓"}:
        return "对"
    if answer in {"错", "错误", "×", "X", "x"}:
        return "错"
    raise ValueError(f"unknown judge answer: {value}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sheet_export", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    exported = json.loads(args.sheet_export.read_text(encoding="utf-8"))
    values = exported.get("values")
    if exported.get("sheet") != "第2周安规考试题库":
        raise ValueError("unexpected worksheet name")
    if not isinstance(values, list) or values[0] != EXPECTED_HEADER:
        raise ValueError("unexpected workbook header")
    if len(values) != 270:
        raise ValueError(f"expected 269 questions, found {len(values) - 1}")

    questions = []
    counts: Counter[str] = Counter()
    for expected_number, row in enumerate(values[1:], start=1):
        if len(row) != 4:
            raise ValueError(f"row {expected_number + 1} does not have four columns")
        number = int(row[0])
        section = clean(row[1])
        if number != expected_number:
            raise ValueError(f"expected question {expected_number}, found {number}")
        if section not in TYPE_MAP:
            raise ValueError(f"unknown question type at {number}: {section}")

        counts[section] += 1
        if section == "选择题":
            stem, options = split_choice(row[2])
            answer = clean(row[3]).upper()
            if answer not in {option["key"] for option in options}:
                raise ValueError(f"answer {answer!r} is not an option for question {number}")
        elif section == "判断题":
            stem = clean(row[2])
            options = []
            answer = normalize_judge(row[3])
        else:
            stem = clean(row[2])
            options = []
            answer = clean(row[3])
        if not stem or not answer:
            raise ValueError(f"question {number} has an empty stem or answer")

        questions.append(
            {
                "id": f"safetyweek2-{number:04d}",
                "number": number,
                "chapter": section,
                "section": section,
                "type": TYPE_MAP[section],
                "stem": stem,
                "options": options,
                "answer": answer,
                "answerRaw": clean(row[3]),
            }
        )

    if counts != EXPECTED_COUNTS:
        raise ValueError(f"unexpected type counts: {dict(counts)}")

    bank = {
        "id": "safetyweek2",
        "title": "第2周安规考试题库",
        "source": "用户提供的《第2周安规考试题库.xlsx》",
        "questionCount": len(questions),
        "chapters": list(TYPE_MAP),
        "questions": questions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(bank, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Created {args.output}: {len(questions)} questions; {dict(counts)}")


if __name__ == "__main__":
    main()
