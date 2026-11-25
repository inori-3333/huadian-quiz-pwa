#!/usr/bin/env python3
"""Import the three 调度业务联系资格培训 (dispatch qualification) workbooks.

The source workbooks are single-sheet "汇总" exports with one row per question:
序号 / 题目类型 / 所属专业 / 题目内容 / 选项A-D / 答案 / 备注.  The reader uses
only the Python standard library (zipfile + ElementTree) so it works without
openpyxl, and refuses a layout it does not recognise instead of guessing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
HEADER = ["序号", "题目类型", "所属专业", "题目内容", "选项A", "选项B", "选项C", "选项D", "答案", "备注"]
TYPE_MAP = {"单选": ("single", "单选题"), "多选": ("multiple", "多选题"), "判断": ("judge", "判断题"), "填空": ("fill", "填空题")}

BANKS = [
    ("basic", "dispatchbasic", "调度业务联系资格培训题库·调度基础", "dispatch-basic.json"),
    ("wind", "dispatchwind", "调度业务联系资格培训题库·风电", "dispatch-wind.json"),
    ("pv", "dispatchpv", "调度业务联系资格培训题库·光伏", "dispatch-pv.json"),
]


def column_index(reference: str) -> int:
    match = re.match(r"([A-Z]+)", reference)
    if not match:
        raise ValueError(f"Bad cell reference: {reference}")
    index = 0
    for char in match.group(1):
        index = index * 26 + ord(char) - 64
    return index - 1


def read_sheet(path: Path) -> list[list[str]]:
    """Return the first worksheet as a rectangular list of trimmed strings."""
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        if "xl/sharedStrings.xml" in names:
            shared = [
                "".join(node.text or "" for node in item.iter(f"{NS}t"))
                for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall(f"{NS}si")
            ]
        else:
            shared = []
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relations = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {relation.get("Id"): relation.get("Target") for relation in relations}
        sheets = list(workbook.find(f"{NS}sheets"))
        if len(sheets) != 1:
            raise ValueError(f"{path.name}: expected exactly one worksheet, found {len(sheets)}")
        sheet = sheets[0]
        target = targets[sheet.get(f"{RNS}id")] or ""
        target = target if target.startswith("xl/") else f"xl/{target}"
        rows = []
        for row in ET.fromstring(archive.read(target)).findall(f"{NS}sheetData/{NS}row"):
            cells: dict[int, str] = {}
            for cell in row.findall(f"{NS}c"):
                value = cell.find(f"{NS}v")
                inline = cell.find(f"{NS}is")
                if value is not None:
                    text = value.text or ""
                    if cell.get("t") == "s":
                        text = shared[int(text)]
                elif inline is not None:
                    text = "".join(node.text or "" for node in inline.iter(f"{NS}t"))
                else:
                    text = ""
                cells[column_index(cell.get("r"))] = text
            width = max(cells) + 1 if cells else 0
            rows.append([cells.get(index, "") for index in range(width)])
        return rows


def clean(value: str) -> str:
    return re.sub(r"[ \t\u00a0]+", " ", value.replace("\r\n", "\n").replace("\r", "\n").replace("\n", " ")).strip()


def convert(path: Path, bank_id: str, title: str) -> tuple[dict, dict]:
    rows = read_sheet(path)
    if not rows or [clean(cell) for cell in rows[0][: len(HEADER)]] != HEADER:
        raise ValueError(f"{path.name}: unexpected header {rows[0] if rows else '<empty>'}")
    questions: list[dict] = []
    chapters: list[str] = []
    types: Counter[str] = Counter()
    for offset, row in enumerate(rows[1:], start=2):
        row = [clean(cell) for cell in (row + [""] * len(HEADER))[: len(HEADER)]]
        if not any(row):
            continue
        serial, raw_type, professional, stem, *rest = row
        options_raw, answer, _note = rest[:4], rest[4], rest[5] if len(rest) > 5 else ""
        if raw_type not in TYPE_MAP:
            raise ValueError(f"{path.name}:{offset}: unknown type {raw_type!r}")
        type_id, section = TYPE_MAP[raw_type]
        if not stem:
            raise ValueError(f"{path.name}:{offset}: missing stem")
        if not answer:
            raise ValueError(f"{path.name}:{offset}: missing answer")
        if not professional:
            raise ValueError(f"{path.name}:{offset}: missing professional group")
        options = []
        for key, text in zip("ABCD", options_raw):
            if text:
                options.append({"key": key, "text": text})
            elif any(later for later in options_raw[len(options) :]):
                raise ValueError(f"{path.name}:{offset}: option {key} is empty before a later option")
        if type_id in ("single", "multiple"):
            if len(options) < 2:
                raise ValueError(f"{path.name}:{offset}: fewer than two options")
            letters = answer.upper()
            if not re.fullmatch(r"[A-H]+", letters) or len(set(letters)) != len(letters):
                raise ValueError(f"{path.name}:{offset}: bad answer {answer!r}")
            if any(letter not in {option["key"] for option in options} for letter in letters):
                raise ValueError(f"{path.name}:{offset}: answer {answer!r} outside options")
            if type_id == "single" and len(letters) != 1:
                raise ValueError(f"{path.name}:{offset}: single choice with answer {answer!r}")
            answer = letters
        elif options:
            raise ValueError(f"{path.name}:{offset}: {raw_type} must not carry options")
        if professional not in chapters:
            chapters.append(professional)
        types[type_id] += 1
        questions.append({
            "id": f"{bank_id}-{len(questions) + 1:04d}",
            "number": int(serial) if serial.isdigit() else len(questions) + 1,
            "chapter": professional,
            "section": section,
            "type": type_id,
            "stem": stem,
            "options": options,
            "answer": answer,
            "answerRaw": rest[4] if len(rest) > 4 else answer,
            "sourceSheet": "汇总",
            "sourceRow": offset,
        })
    if not questions:
        raise ValueError(f"{path.name}: no questions found")
    counts = ", ".join(f"{TYPE_MAP[next(key for key, value in TYPE_MAP.items() if value[0] == type_id)][1]}{amount}" for type_id, amount in types.items())
    bank = {
        "id": bank_id,
        "title": title,
        "source": f"用户提供的《{path.name}》汇总表，{len(questions)}题（{counts}）",
        "questionCount": len(questions),
        "chapters": chapters,
        "questions": questions,
    }
    audit = {
        "sourceFile": path.name,
        "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "sheet": "汇总",
        "questions": len(questions),
        "types": dict(types),
        "chapters": chapters,
        "skippedRows": len(rows) - 1 - len(questions) if len(rows) - 1 > len(questions) else 0,
    }
    return bank, audit


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for key, _bank_id, _title, _file in BANKS:
        parser.add_argument(f"--{key}", type=Path, required=True, help=f"调度业务联系资格培训题库-{key}.xlsx")
    args = parser.parse_args()
    data_dir = ROOT / "app/assets/data"
    audit_dir = ROOT / "sources/dispatch"
    audit_dir.mkdir(parents=True, exist_ok=True)
    audits = []
    for key, bank_id, title, filename in BANKS:
        source = getattr(args, key)
        if not source.is_file():
            raise SystemExit(f"Source workbook not found: {source}")
        bank, audit = convert(source, bank_id, title)
        (data_dir / filename).write_text(
            json.dumps(bank, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
        )
        audits.append(audit)
        print(f"{filename}: {bank['questionCount']} questions from {source.name} ({audit['types']})")
    (audit_dir / "import-audit.json").write_text(
        json.dumps({"banks": audits}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Audit written to {audit_dir / 'import-audit.json'}")
    print("Run python3 scripts/merge_dispatch_banks.py to refresh the combined dispatch-all.json.")


if __name__ == "__main__":
    main()
