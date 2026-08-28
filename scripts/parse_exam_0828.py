#!/usr/bin/env python3
"""Convert the 2026-08-28 compact safety-exam PDF into an app question bank."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
from collections import Counter
from pathlib import Path


GROUP_RE = re.compile(r"^第\s*(\d+)\s*组$")
ANSWER_RE = re.compile(r"^(?:答案|答)[：:]\s*(.*)$")
NUMBER_RE = re.compile(r"^(\d+)\s*[.、，,]\s*(.*)$")
OPTION_RE = re.compile(r"(?<![A-Za-z0-9])([ABCD])(?=(?:[.、．:：]|\s|\d))")


def clean_space(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\x0c", " ")).strip()


def strip_number(value: str) -> tuple[int, str]:
    match = NUMBER_RE.match(value)
    if not match:
        raise ValueError(f"question has no leading number: {value}")
    number = int(match.group(1))
    stem = match.group(2).strip()
    duplicate = NUMBER_RE.match(stem)
    expected_section_number = ((number - 1) % 5) + 1
    if duplicate and int(duplicate.group(1)) in {number, expected_section_number}:
        stem = duplicate.group(2).strip()
    return number, stem


def option_chain(value: str) -> list[re.Match[str]]:
    candidates = list(OPTION_RE.finditer(value))
    for start, candidate in enumerate(candidates):
        if candidate.group(1) != "A":
            continue
        chain = [candidate]
        expected = "B"
        for following in candidates[start + 1:]:
            if following.group(1) == expected:
                chain.append(following)
                if expected == "D":
                    return chain
                expected = chr(ord(expected) + 1)
    raise ValueError(f"could not find A-D options: {value}")


def split_choice(value: str, group: int, number: int) -> tuple[str, list[dict[str, str]]]:
    chain = option_chain(value)
    stem = value[:chain[0].start()].strip()
    options = []
    for index, match in enumerate(chain):
        start = match.end()
        while start < len(value) and (value[start].isspace() or value[start] in ".、．:："):
            start += 1
        end = chain[index + 1].start() if index + 1 < len(chain) else len(value)
        text = value[start:end].strip(" .、；;")
        options.append({"key": match.group(1), "text": clean_space(text)})

    # The source repeats option D and a clause number after group 16 question 1.
    if group == 16 and number == 1:
        options[-1]["text"] = "磨削时，砂轮与工件应保持15°～30°的倾斜位置"
    return clean_space(stem), options


def normalize_choice_answer(raw: str, group: int, number: int) -> str:
    if group == 16 and number == 1 and clean_space(raw) == "7.5.10":
        return "D"
    cleaned = re.sub(r"^(?:答案)[：:]?\s*", "", clean_space(raw))
    match = re.search(r"[ABCD]", cleaned, re.IGNORECASE)
    if not match:
        raise ValueError(f"choice answer has no option key: group {group}, question {number}: {raw}")
    return match.group(0).upper()


def normalize_judge(raw: str) -> str:
    value = clean_space(raw).lower()
    if value in {"✓", "√", "✔", "✅", "对", "正确"}:
        return "对"
    if value in {"×", "✗", "❌", "x", "错", "错误"}:
        return "错"
    raise ValueError(f"unknown judge answer: {raw}")


def parse_text(text: str) -> dict:
    current_group: int | None = None
    current_section: str | None = None
    pending: list[str] = []
    parsed: list[dict] = []

    for original in text.splitlines():
        line = clean_space(original)
        if not line:
            continue
        group_match = GROUP_RE.match(line)
        if group_match:
            if pending:
                raise ValueError(f"unterminated question before {line}: {' '.join(pending)}")
            current_group = int(group_match.group(1))
            current_section = None
            continue
        if line in {"选择题", "填空题", "判断题"}:
            if pending:
                raise ValueError(f"unterminated question before {line}: {' '.join(pending)}")
            current_section = line
            continue
        if line.startswith("解析：") or line.startswith("解析:") or line.startswith("依据 5."):
            continue
        answer_match = ANSWER_RE.match(line)
        if answer_match:
            if current_group is None or current_section is None or not pending:
                raise ValueError(f"answer outside a question: {line}")
            joined = clean_space(" ".join(pending))
            number, body = strip_number(joined)
            parsed.append({
                "group": current_group,
                "section": current_section,
                "number": number,
                "body": body,
                "answerRaw": clean_space(answer_match.group(1)),
            })
            pending = []
            continue
        if current_group is not None and current_section is not None:
            pending.append(line)

    if pending:
        raise ValueError(f"unterminated final question: {' '.join(pending)}")

    questions = []
    for index, item in enumerate(parsed, 1):
        group = item["group"]
        section = item["section"]
        number = item["number"]
        raw = item["answerRaw"]
        if section == "选择题":
            stem, options = split_choice(item["body"], group, number)
            answer = normalize_choice_answer(raw, group, number)
            question_type = "single"
        elif section == "填空题":
            stem = clean_space(item["body"])
            options = []
            answer = raw
            question_type = "fill"
        else:
            stem = clean_space(item["body"])
            options = []
            answer = normalize_judge(raw)
            question_type = "judge"
        questions.append({
            "id": f"exam0828-{index:04d}",
            "number": number,
            "chapter": f"第{group}组",
            "section": section,
            "type": question_type,
            "stem": stem,
            "options": options,
            "answer": answer,
            "answerRaw": raw,
        })

    validate(questions)
    return {
        "id": "exam0828",
        "title": "安规考试8.28题库",
        "source": "由用户提供的《安规考试题库汇总_第1至18组_紧凑版.pdf》整理",
        "questionCount": len(questions),
        "chapters": [f"第{group}组" for group in range(1, 19)],
        "questions": questions,
    }


def validate(questions: list[dict]) -> None:
    if len(questions) != 270:
        raise ValueError(f"expected 270 questions, found {len(questions)}")
    counts = Counter((question["chapter"], question["section"]) for question in questions)
    for group in range(1, 19):
        for section in ("选择题", "填空题", "判断题"):
            count = counts[(f"第{group}组", section)]
            if count != 5:
                raise ValueError(f"第{group}组 {section}: expected 5, found {count}")
    for question in questions:
        if not question["stem"] or not question["answer"]:
            raise ValueError(f"empty question content: {question['id']}")
        if question["type"] == "single":
            if [option["key"] for option in question["options"]] != list("ABCD"):
                raise ValueError(f"invalid options: {question['id']}")
            if question["answer"] not in {option["key"] for option in question["options"]}:
                raise ValueError(f"answer not in options: {question['id']}")
            if any(not option["text"] for option in question["options"]):
                raise ValueError(f"blank option: {question['id']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="exam0828-") as temp:
        text_path = Path(temp) / "bank.txt"
        subprocess.run(["pdftotext", "-layout", args.pdf, text_path], check=True)
        bank = parse_text(text_path.read_text(encoding="utf-8"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bank, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{args.output}: {bank['questionCount']} questions")


if __name__ == "__main__":
    main()
