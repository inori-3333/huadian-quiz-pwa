#!/usr/bin/env python3
"""Update one app question group from an artifact-tool workbook JSON export."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


OPTION_RE = re.compile(r"(?<![A-Za-z0-9])([ABCD])[.、．:：]")
SECTION_TYPES = {"选择题": "single", "填空题": "fill", "判断题": "judge"}


def clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value)).strip()


def split_choice(value: object) -> tuple[str, list[dict[str, str]]]:
    text = clean(value)
    matches = list(OPTION_RE.finditer(text))
    if [match.group(1) for match in matches] != list("ABCD"):
        raise ValueError(f"expected exactly A-D options: {text}")
    stem = text[: matches[0].start()].strip()
    options = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        option = text[match.end() : end].strip(" .。；;")
        options.append({"key": match.group(1), "text": option})
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
    parser.add_argument("bank", type=Path)
    parser.add_argument("--group", type=int, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    exported = json.loads(args.sheet_export.read_text(encoding="utf-8"))
    sheets = {sheet["name"]: sheet["values"] for sheet in exported["sheets"]}
    bank = json.loads(args.bank.read_text(encoding="utf-8"))
    chapter = f"第{args.group}组"
    changes: list[str] = []

    for section in ("选择题", "填空题", "判断题"):
        rows = sheets[section]
        if rows[0][:3] != ["序号", "题目", "答案"] or len(rows) != 6:
            raise ValueError(f"unexpected {section} layout")
        for row in rows[1:]:
            number = int(row[0])
            matches = [
                question
                for question in bank["questions"]
                if question["chapter"] == chapter
                and question["section"] == section
                and question["number"] == number
            ]
            if len(matches) != 1:
                raise ValueError(f"expected one target for {chapter} {section} {number}, found {len(matches)}")
            question = matches[0]
            before = json.dumps(question, ensure_ascii=False, sort_keys=True)
            if section == "选择题":
                stem, options = split_choice(row[1])
                answer = clean(row[2]).upper()
                if answer not in {option["key"] for option in options}:
                    raise ValueError(f"answer {answer} is not an option for {section} {number}")
            else:
                stem = clean(row[1])
                options = []
                answer = normalize_judge(row[2]) if section == "判断题" else clean(row[2])
            question.update(
                type=SECTION_TYPES[section],
                stem=stem,
                options=options,
                answer=answer,
                answerRaw=answer,
            )
            after = json.dumps(question, ensure_ascii=False, sort_keys=True)
            if before != after:
                changes.append(f"{chapter} {section} {number}: updated")

    group_questions = [question for question in bank["questions"] if question["chapter"] == chapter]
    if len(group_questions) != 15:
        raise ValueError(f"expected 15 questions in {chapter}, found {len(group_questions)}")
    bank["source"] = "由用户提供的题库汇总资料及《3组=题目(2).xlsx》整理"
    print("\n".join(changes) if changes else "No changes")
    if not args.dry_run:
        args.bank.write_text(
            json.dumps(bank, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
