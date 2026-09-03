#!/usr/bin/env python3
"""Parse the Youth Theory Knowledge Competition (Issue 2) PDF into app JSON."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber


PARTS = {
    "第一部分": ("第一部分：党的理论", {"single": 75, "multiple": 43, "judge": 42}),
    "第二部分": ("第二部分：党史知识", {"single": 24, "multiple": 15, "judge": 10}),
    "第三部分": ("第三部分：团青知识", {"single": 58, "multiple": 31, "judge": 31}),
    "第四部分": ("第四部分：行业信息", {"single": 43, "multiple": 15, "judge": 15}),
    "第五部分": ("第五部分：管理知识", {"single": 48, "multiple": 26, "judge": 24}),
    "第六部分": ("第六部分：安全生产", {"single": 20, "multiple": 10, "judge": 10}),
    "第七部分": ("第七部分：公文常识", {"single": 20, "multiple": 10, "judge": 10}),
}
TYPE_NAMES = {"单选题": "single", "多选题": "multiple", "判断题": "judge"}
EXPECTED_TOTAL = 580

PART_RE = re.compile(r"第[一二三四五六七]部分\s*[：:]\s*[^\s]+")
TYPE_RE = re.compile(r"^[一二三]\s*[、.]\s*(单选题|多选题|判断题)")
QUESTION_RE = re.compile(r"^\s*(\d{1,3})\s*[.．]\s*(.+)$")
ANSWER_RE = re.compile(r"答案\s*[：:]?\s*(.+)")
OPTION_TOKEN_RE = re.compile(r"(?<![A-Z])([A-H])\s*[.．、]\s*")
FOOTER_RE = re.compile(r"^\s*[—-](?:\s*\d+\s*[—-]?)?\s*$")


@dataclass
class Draft:
    number: int
    chapter: str
    question_type: str
    lines: list[str] = field(default_factory=list)
    answer_raw: str = ""


def compact(text: str) -> str:
    text = text.replace("\u3000", " ").replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_reading_order(pdf_path: Path) -> list[str]:
    lines: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        # Cover, introduction and contents occupy the first three pages.
        for page in pdf.pages[3:]:
            midpoint = page.width / 2
            # Keep a narrow gutter: a wider crop can clip the first Chinese
            # character of short lines such as "答案：D" in the right column.
            gutter = page.width * 0.008
            for box in (
                (0, 0, midpoint - gutter, page.height),
                (midpoint + gutter, 0, page.width, page.height),
            ):
                text = page.crop(box).extract_text(x_tolerance=2, y_tolerance=3) or ""
                for raw_line in text.splitlines():
                    line = compact(raw_line)
                    if line and not FOOTER_RE.match(line):
                        lines.append(line)
    return lines


def normalize_answer(question_type: str, raw: str) -> str:
    value = compact(raw)
    if question_type in {"single", "multiple"}:
        return "".join(sorted(set(re.findall(r"[A-H]", value.upper()))))
    if any(token in value for token in ("错误", "错", "×", "✕", "X")):
        return "错"
    if any(token in value for token in ("正确", "对", "√", "✓")):
        return "对"
    return value


def build_question(draft: Draft, serial: int) -> dict:
    answer = normalize_answer(draft.question_type, draft.answer_raw)
    if not answer:
        raise ValueError(f"{draft.chapter} {draft.question_type} 第 {draft.number} 题缺少答案")

    if draft.question_type == "judge":
        stem = compact(" ".join(draft.lines))
        options: list[dict[str, str]] = []
    else:
        stem_lines: list[str] = []
        parsed_options: list[tuple[str, list[str]]] = []
        for line in draft.lines:
            matches = list(OPTION_TOKEN_RE.finditer(line))
            if not matches:
                if parsed_options:
                    parsed_options[-1][1].append(line)
                else:
                    stem_lines.append(line)
                continue

            prefix = line[: matches[0].start()].strip()
            if prefix and parsed_options:
                parsed_options[-1][1].append(prefix)
            elif prefix:
                stem_lines.append(prefix)
            for index, match in enumerate(matches):
                end = matches[index + 1].start() if index + 1 < len(matches) else len(line)
                parsed_options.append((match.group(1), [line[match.end() : end].strip()]))
        stem = compact(" ".join(stem_lines))
        options = [
            {"key": key, "text": compact(" ".join(text_lines))}
            for key, text_lines in parsed_options
        ]
        if len(options) < 2:
            raise ValueError(
                f"{draft.chapter} {draft.question_type} 第 {draft.number} 题仅解析到 {len(options)} 个选项"
            )
        if len({option["key"] for option in options}) != len(options):
            raise ValueError(f"{draft.chapter} {draft.question_type} 第 {draft.number} 题存在重复选项")
        option_keys = {option["key"] for option in options}
        if not set(answer) <= option_keys:
            raise ValueError(
                f"{draft.chapter} {draft.question_type} 第 {draft.number} 题答案 {answer} 不在选项 {sorted(option_keys)} 中；原始行: {draft.lines!r}"
            )

    if not stem:
        raise ValueError(f"{draft.chapter} {draft.question_type} 第 {draft.number} 题缺少题干")
    searchable = " ".join([stem, *(option["text"] for option in options)])
    if re.search(r"(?:^|\s)—\s*\d+(?:\s|$)", searchable):
        raise ValueError(f"{draft.chapter} {draft.question_type} 第 {draft.number} 题包含疑似页码")
    section = {"single": "单选题", "multiple": "多选题", "judge": "判断题"}[draft.question_type]
    return {
        "id": f"youththeory2-{serial:04d}",
        "number": draft.number,
        "chapter": draft.chapter,
        "section": section,
        "type": draft.question_type,
        "stem": stem,
        "options": options,
        "answer": answer,
        "answerRaw": compact(draft.answer_raw),
    }


def parse_questions(lines: list[str]) -> list[dict]:
    questions: list[dict] = []
    current_part: str | None = None
    current_type: str | None = None
    draft: Draft | None = None
    expected_number = 1

    def finish() -> None:
        nonlocal draft
        if draft is None:
            return
        questions.append(build_question(draft, len(questions) + 1))
        draft = None

    for line in lines:
        # One source line is laid out as ``5.《...》`` but the PDF text layer
        # emits ``5《....``. Normalize that extraction-order anomaly.
        line = re.sub(r"^(\d{1,3})([《“（])\s*[.．]\s*", r"\1.\2", line)
        if line.startswith("附录"):
            finish()
            break

        part_match = PART_RE.search(line)
        if part_match:
            matched_key = next((key for key in PARTS if key in part_match.group(0)), None)
            if matched_key:
                if draft and draft.answer_raw:
                    finish()
                current_part = PARTS[matched_key][0]
                current_type = None
                expected_number = 1
                continue

        type_match = TYPE_RE.match(line)
        if type_match and current_part:
            if draft and draft.answer_raw:
                finish()
            current_type = TYPE_NAMES[type_match.group(1)]
            expected_number = 1
            continue

        if not current_part or not current_type:
            continue

        answer_match = ANSWER_RE.search(line)
        if answer_match and draft:
            draft.answer_raw = answer_match.group(1)
            continue

        question_match = QUESTION_RE.match(line)
        if question_match:
            number = int(question_match.group(1))
            if number == expected_number and (draft is None or draft.answer_raw):
                if draft:
                    finish()
                draft = Draft(number, current_part, current_type, [question_match.group(2)])
                expected_number += 1
                continue

        if draft and not draft.answer_raw:
            draft.lines.append(line)

    finish()
    return questions


def validate(questions: list[dict]) -> None:
    if len(questions) != EXPECTED_TOTAL:
        actual = {
            chapter: {
                question_type: sum(
                    question["chapter"] == chapter and question["type"] == question_type
                    for question in questions
                )
                for question_type in expected_types
            }
            for _, (chapter, expected_types) in PARTS.items()
        }
        raise ValueError(f"应解析 {EXPECTED_TOTAL} 题，实际解析 {len(questions)} 题；分组统计: {actual}")
    if len({question["id"] for question in questions}) != EXPECTED_TOTAL:
        raise ValueError("题目 ID 不唯一")

    for _, (chapter, expected_types) in PARTS.items():
        for question_type, expected_count in expected_types.items():
            group = [
                question
                for question in questions
                if question["chapter"] == chapter and question["type"] == question_type
            ]
            if len(group) != expected_count:
                raise ValueError(
                    f"{chapter} {question_type} 应有 {expected_count} 题，实际 {len(group)} 题"
                )
            expected_numbers = list(range(1, expected_count + 1))
            actual_numbers = [question["number"] for question in group]
            if actual_numbers != expected_numbers:
                raise ValueError(f"{chapter} {question_type} 题号不连续: {actual_numbers}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("app/assets/data/youth-theory-2.json"),
    )
    args = parser.parse_args()

    questions = parse_questions(extract_reading_order(args.pdf))
    validate(questions)
    bank = {
        "id": "youththeory2",
        "title": "青年理论知识网络学习竞赛题库（第二期）",
        "source": "中国华电集团有限公司党建工作部编，2026年8月",
        "questionCount": len(questions),
        "chapters": [chapter for chapter, _ in PARTS.values()],
        "questions": questions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(bank, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(questions)} questions to {args.output}")


if __name__ == "__main__":
    main()
