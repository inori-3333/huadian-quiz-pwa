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
import hashlib
import re
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET


WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{WORD_NS}}}"
CLAUSE_RE = re.compile(r"^(?P<ref>[1-9]\d?(?:\.\d+)+|[A-J]\.\d+(?:\.\d+)*)(?:\s+|$)(?P<text>.*)$")
EMBEDDED_CLAUSE_RE = re.compile(
    r"(?<=[。;；])\s+(?P<ref>[1-9]\d?(?:\.\d+){2,}|[A-J](?:\.\d+)+)\s+"
)
BODY_START_RE = re.compile(r"^1\s*范\s*围$")
TOP_LEVEL_RE = re.compile(r"^(?P<ref>[1-9]\d?)\s+[\u3400-\u9fff][\u3400-\u9fff、与及和 ]*$")
ANNEX_RE = re.compile(r"^附录\s*(?P<ref>[A-J])(?:\s*\([^)]*\))?$")
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
        if node.tag in {f"{W}t", "{http://schemas.openxmlformats.org/officeDocument/2006/math}t"} and node.text:
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
            if text:
                cells.append(text)
        if cells:
            rows.append(cells)
    return rows


def document_blocks(path: Path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    body = root.find(f"{W}body")
    if body is None:
        raise ValueError(f"{path} has no Word document body")
    def walk(element):
        for child in element:
            if child.tag == f"{W}p":
                yield "paragraph", paragraph_text(child)
            elif child.tag == f"{W}tbl":
                yield "table", table_rows(child)
            else:
                # Content controls and custom XML can wrap body paragraphs/tables.
                yield from walk(child)
    yield from walk(body)


def is_layout_artifact(text: str, next_text: str | None = None) -> bool:
    if PAGE_HEADER_RE.fullmatch(text):
        return True
    # A bare number can be a split measurement. Discard it only at a page
    # boundary (next nonempty block is a running header, or document ends).
    return bool(PAGE_NUMBER_RE.fullmatch(text) and
                (next_text is None or re.match(r"^Q\s*/?\s*CHD\s*85\.[12]\s*[-—]\s*2024", next_text, re.I)))


def extract_source(source: Source, audit: dict | None = None) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    current_ref = ""
    current_parts: list[str] = []
    current_caption = ""
    table_number = 0
    started = False
    coverage = []
    paragraph_count = 0
    cell_count = 0

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
            segment = text[match.start():end].strip()
            current_parts = [segment] if segment else []

    blocks = list(document_blocks(source.path))
    for block_index, (kind, content) in enumerate(blocks):
        if kind == "paragraph":
            text = content
            if not text:
                continue
            if not started:
                started = bool(BODY_START_RE.fullmatch(text))
                if not started:
                    continue
            next_text = next((str(value) for _, value in blocks[block_index + 1:] if value), None)
            if is_layout_artifact(text, next_text):
                continue

            paragraph_count += 1
            # Account for every body paragraph, excluding only explicit layout artifacts.
            coverage.append(text)
            heading = TOP_LEVEL_RE.fullmatch(text) or ANNEX_RE.fullmatch(text)
            if heading:
                flush_clause()
                current_ref = heading.group("ref")
                current_parts = [text]
                current_caption = ""
                continue

            clause = CLAUSE_RE.match(text)
            if not clause and re.fullmatch(r"(?:[1-9]\d?|[A-J])(?:\.\d+)+", current_ref):
                # Some converted paragraphs join the clause number to a value:
                # 7.2.1.76kV. Require BOTH neighboring clauses to prove the split.
                parent, number = current_ref.rsplit(".", 1)
                expected = f"{parent}.{int(number) + 1}"
                following = next((CLAUSE_RE.match(value) for kind, value in blocks[block_index + 1:]
                                  if kind == "paragraph" and CLAUSE_RE.match(value)), None)
                if (text.startswith(expected) and
                        re.match(r"^\d+(?:\.\d+)?[a-zA-Z°%]", text[len(expected):]) and
                        following and following.group("ref") == f"{parent}.{int(number) + 2}"):
                    text = expected + " " + text[len(expected):]
                    clause = CLAUSE_RE.match(text)
            if clause:
                flush_clause()
                current_ref = clause.group("ref")
                current_parts = []
                consume_paragraph(text)
                current_caption = ""
                continue

            if TABLE_CAPTION_RE.match(text):
                current_caption = text
                current_parts.append(text)
                continue

            consume_paragraph(text)
            continue

        rows = content
        if not started or not rows:
            continue
        if not current_ref:
            raise ValueError("Table has no chapter or annex context")
        table_number += 1
        header = "；".join(rows[0])
        caption_match = TABLE_CAPTION_RE.match(current_caption)
        table_ref = (caption_match.group("ref").lstrip(".") if caption_match and "." not in current_ref else current_ref)
        for row_number, cells in enumerate(rows, start=1):
            coverage.extend(cells)
            cell_count += len(cells)
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
    if not started:
        raise ValueError("Document body start (1 范围) was not found")
    # Validate against the original blocks, independently of classification. Keeping
    # clause labels makes a joined paragraph auditable even when it spans records.
    normalized_records = [re.sub(r"\s+", "", record["text"]) for record in records]
    corpus = "\n".join(normalized_records)
    missing = []
    for text in coverage:
        # Embedded clause boundaries may split a single Word paragraph.
        segments = re.split(r"(?<=[。;；])\s+(?=[1-9]\d?(?:\.\d+){2,}\s|[A-J](?:\.\d+)+\s)", text)
        for segment in segments:
            if re.sub(r"\s+", "", segment) not in corpus:
                missing.append(segment)
    if missing:
        raise ValueError(f"Incomplete extraction: {len(missing)} missing segments: {missing[:3]}")
    if audit is not None:
        audit.update(source=source.id, sha256=hashlib.sha256(source.path.read_bytes()).hexdigest(),
                     bodyParagraphs=paragraph_count, tableBlocks=table_number,
                     tableCells=cell_count, checkedTextUnits=len(coverage), missingTextUnits=0)
    for index, record in enumerate(records, start=1):
        record["id"] = f"{source.id}-{index:04d}"
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--general", type=Path, help="Q/CHD 85.1-2024 DOCX")
    parser.add_argument("--coal", type=Path, help="Q/CHD 85.2-2024 DOCX")
    parser.add_argument("--output", type=Path, default=Path("app/assets/data/regulations.json"))
    parser.add_argument("--audit-output", type=Path, default=Path("sources/regulations/import-audit.json"))
    args = parser.parse_args()
    if not args.general and not args.coal:
        parser.error("Provide at least one of --general or --coal")

    existing = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {"sources": [], "clauses": []}
    sources, clauses, audits = [], [], []
    for source_id, title, standard, path in [
        ("general", "第1部分：通用要求", "Q/CHD 85.1—2024", args.general),
        ("coal", "第2部分：燃煤发电", "Q/CHD 85.2—2024", args.coal),
    ]:
        if path is None:
            previous = next((s for s in existing["sources"] if s["id"] == source_id), None)
            if previous is None:
                parser.error(f"Missing --{source_id} and no existing source to preserve")
            sources.append(previous)
            clauses.extend(c for c in existing["clauses"] if c["source"] == source_id)
            audits.append({"source": source_id, "status": "preserved_without_source_audit"})
            continue
        source = Source(source_id, title, standard, path.resolve())
        audit = {"status": "verified_text_coverage"}
        records = extract_source(source, audit)
        audit.update(recordCount=len(records))
        audits.append(audit)
        clauses.extend(records)
        sources.append({"id": source_id, "title": title, "standard": standard,
                        "file": path.name, "recordCount": len(records)})

    payload = {"version": 1, "sources": sources, "clauses": clauses}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    args.audit_output.parent.mkdir(parents=True, exist_ok=True)
    args.audit_output.write_text(json.dumps({"sources": audits}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(clauses)} searchable regulation records to {args.output.resolve()}")
    for audit in audits:
        print(json.dumps(audit, ensure_ascii=False))


if __name__ == "__main__":
    main()
