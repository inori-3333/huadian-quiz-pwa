#!/usr/bin/env python3
"""Extract searchable clauses from the 2024 Q/CHD 85 Word documents.

The source files were converted from paginated documents, so clauses can be
split by page headers and page breaks.  This importer joins those fragments,
normalizes layout-only whitespace, and turns table rows into searchable
records without treating either document as a question bank.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET


WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{WORD_NS}}}"
CLAUSE_RE = re.compile(r"^(?P<ref>\d+(?:\.\d+)+|[A-J]\.\d+(?:\.\d+)*)\s*(?P<text>.*)$")
EMBEDDED_CLAUSE_RE = re.compile(
    r"(?<![\w.])(?P<ref>(?:\d+\.){2,}\d+|[A-J](?:\.\d+){2,})\s+"
)
BODY_START_RE = re.compile(r"^1\s*范\s*围$")
TOP_LEVEL_RE = re.compile(r"^\d+\s+[^\d.]")
PAGE_NUMBER_RE = re.compile(r"^(?:\d{1,3}|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]{1,8})$")
PAGE_HEADER_RE = re.compile(r"^Q\s*/?\s*CHD\s*85\.[12]\s*[-—]\s*2024$", re.IGNORECASE)
TABLE_CAPTION_RE = re.compile(r"^表\s*(?P<ref>[A-J]?\.?\d+(?:\.\d+)?)")


@dataclass(frozen=True)
class Source:
    id: str
    title: str
    standard: str
    path: Path


def compact_text(value: str) -> str:
    """Remove pagination whitespace while preserving meaningful word breaks."""
    value = unicodedata.normalize("NFKC", value)
    value = value.replace("\u00a0", " ").replace("\u3000", " ")
    value = re.sub(r"\s+", " ", value).strip()
    cjk = r"\u3400-\u4dbf\u4e00-\u9fff"
    value = re.sub(fr"(?<=[{cjk}])\s+(?=[{cjk}])", "", value)
    value = re.sub(fr"(?<=[{cjk}])\s+(?=[,，。;；:：、)）])", "", value)
    value = re.sub(fr"(?<=[(（])\s+(?=[{cjk}])", "", value)
    value = re.sub(r"\s+([%℃°])", r"\1", value)
    return value


def paragraph_text(element: ET.Element) -> str:
    parts: list[str] = []
    for node in element.iter():
        if node.tag == f"{W}t" and node.text:
            parts.append(node.text)
        elif node.tag in {f"{W}tab", f"{W}br"}:
            parts.append(" ")
    return compact_text("".join(parts))


def table_rows(element: ET.Element) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in element.findall(f"{W}tr"):
        cells: list[str] = []
        for cell in row.findall(f"{W}tc"):
            text = compact_text(" ".join(paragraph_text(p) for p in cell.findall(f".//{W}p")))
            if text and (not cells or cells[-1] != text):
                cells.append(text)
        if cells and (not rows or rows[-1] != cells):
            rows.append(cells)
    return rows


def document_blocks(path: Path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    body = root.find(f"{W}body")
    if body is None:
        raise ValueError(f"{path} has no Word document body")
    for child in body:
        if child.tag == f"{W}p":
            yield "paragraph", paragraph_text(child)
        elif child.tag == f"{W}tbl":
            yield "table", table_rows(child)


def is_layout_artifact(text: str) -> bool:
    return bool(PAGE_NUMBER_RE.fullmatch(text) or PAGE_HEADER_RE.fullmatch(text))


def extract_source(source: Source) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    current_ref = ""
    current_parts: list[str] = []
    current_caption = ""
    table_number = 0
    started = False

    def flush_clause() -> None:
        nonlocal current_ref, current_parts
        if not current_ref:
            return
        text = compact_text(" ".join(current_parts))
        if text:
            records.append({
                "source": source.id,
                "ref": current_ref,
                "kind": "clause",
                "text": text,
            })
        current_ref = ""
        current_parts = []

    def consume_paragraph(text: str) -> None:
        """Consume a paragraph, including clause markers embedded after a page join."""
        nonlocal current_ref, current_parts
        matches = list(EMBEDDED_CLAUSE_RE.finditer(text))
        if not matches:
            if current_ref:
                current_parts.append(text)
            return
        prefix = text[:matches[0].start()].strip()
        if prefix and current_ref:
            current_parts.append(prefix)
        for index, match in enumerate(matches):
            flush_clause()
            current_ref = match.group("ref")
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            segment = text[match.end():end].strip()
            current_parts = [segment] if segment else []

    for kind, content in document_blocks(source.path):
        if kind == "paragraph":
            text = content
            if not text:
                continue
            if not started:
                started = bool(BODY_START_RE.fullmatch(text))
                continue
            if is_layout_artifact(text):
                continue

            clause = CLAUSE_RE.match(text)
            if clause:
                flush_clause()
                current_ref = clause.group("ref")
                current_parts = []
                if clause.group("text"):
                    consume_paragraph(clause.group("text"))
                current_caption = ""
                continue

            if TABLE_CAPTION_RE.match(text):
                current_caption = text
                continue

            if TOP_LEVEL_RE.match(text) or text.startswith("附录"):
                flush_clause()
                current_caption = ""
                continue

            consume_paragraph(text)
            continue

        rows = content
        if not started or not rows or (not current_ref and not current_caption):
            continue
        table_number += 1
        header = "；".join(rows[0])
        caption_match = TABLE_CAPTION_RE.match(current_caption)
        table_ref = current_ref or (caption_match.group("ref").lstrip(".") if caption_match else "表格")
        for row_number, cells in enumerate(rows[1:], start=1):
            row_text = "；".join(cells)
            if not row_text:
                continue
            prefix = f"{current_caption}。" if current_caption else ""
            records.append({
                "source": source.id,
                "ref": table_ref,
                "kind": "table",
                "table": str(table_number),
                "text": compact_text(f"{prefix}表头: {header}。本行: {row_text}"),
            })

    flush_clause()
    for index, record in enumerate(records, start=1):
        record["id"] = f"{source.id}-{index:04d}"
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--general", type=Path, required=True, help="Q/CHD 85.1-2024 DOCX")
    parser.add_argument("--coal", type=Path, required=True, help="Q/CHD 85.2-2024 DOCX")
    parser.add_argument("--output", type=Path, default=Path("app/assets/data/regulations.json"))
    args = parser.parse_args()

    sources = [
        Source("general", "第1部分：通用要求", "Q/CHD 85.1—2024", args.general.resolve()),
        Source("coal", "第2部分：燃煤发电", "Q/CHD 85.2—2024", args.coal.resolve()),
    ]
    for source in sources:
        if not source.path.is_file():
            raise FileNotFoundError(source.path)

    clauses = [record for source in sources for record in extract_source(source)]
    payload = {
        "version": 1,
        "sources": [
            {
                "id": source.id,
                "title": source.title,
                "standard": source.standard,
                "file": source.path.name,
                "recordCount": sum(record["source"] == source.id for record in clauses),
            }
            for source in sources
        ],
        "clauses": clauses,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(clauses)} searchable regulation records to {args.output.resolve()}")


if __name__ == "__main__":
    main()
