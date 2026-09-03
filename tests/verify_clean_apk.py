#!/usr/bin/env python3
"""Structural security and content checks for the release APK."""

from __future__ import annotations

import argparse
import json
import struct
import zipfile


FORBIDDEN_DEX = (
    b"JavascriptInterface",
    b"addJavascriptInterface",
    b"requestPermission",
    b"openWindow",
    b"showNotification",
    b"documentFloating",
    b"DownloadManager",
    b"HttpURLConnection",
)


def string_pool(data: bytes) -> tuple[dict[int, str], int]:
    offset = 8
    kind, header_size, size = struct.unpack_from("<HHI", data, offset)
    assert kind == 1
    count, _styles, flags, start, _style_start = struct.unpack_from("<IIIII", data, offset + 8)
    assert not flags & 0x100
    offsets = offset + header_size
    strings = offset + start
    values = {}
    for index in range(count):
        cursor = strings + struct.unpack_from("<I", data, offsets + index * 4)[0]
        length = struct.unpack_from("<H", data, cursor)[0]
        assert not length & 0x8000
        cursor += 2
        values[index] = data[cursor:cursor + length * 2].decode("utf-16le")
    return values, offset + size


def manifest_facts(data: bytes) -> tuple[list[str], dict[str, tuple[int, int, str | None]]]:
    strings, cursor = string_pool(data)
    elements: list[str] = []
    attributes: dict[str, tuple[int, int, str | None]] = {}
    assert struct.unpack_from("<I", data, 4)[0] == len(data)
    while cursor + 8 <= len(data):
        kind, _header, size = struct.unpack_from("<HHI", data, cursor)
        assert size >= 8 and cursor + size <= len(data)
        if kind == 0x0102:
            elements.append(strings[struct.unpack_from("<I", data, cursor + 20)[0]])
            start, item_size, count = struct.unpack_from("<HHH", data, cursor + 24)
            base = cursor + 16 + start
            for index in range(count):
                item = base + index * item_size
                name = strings[struct.unpack_from("<I", data, item + 4)[0]]
                raw_index = struct.unpack_from("<I", data, item + 8)[0]
                raw = None if raw_index == 0xFFFFFFFF else strings[raw_index]
                attributes[name] = (data[item + 15], struct.unpack_from("<I", data, item + 16)[0], raw)
        cursor += size
    return elements, attributes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("apk")
    args = parser.parse_args()
    with zipfile.ZipFile(args.apk) as apk:
        names = set(apk.namelist())
        required = {
            "AndroidManifest.xml",
            "classes.dex",
            "assets/index.html",
            "assets/banks-data.js",
            "assets/regulations-data.js",
            "assets/assets/data/exam0828.json",
            "assets/assets/data/safety-week2.json",
            "assets/assets/data/youth-theory-2.json",
            "assets/assets/data/safety2024general.json",
            "assets/assets/data/safety2024coal.json",
            "assets/assets/data/regulations.json",
        }
        assert required <= names, required - names
        assert "assets/assets/data/safety.json" not in names
        assert "assets/assets/data/theory.json" not in names
        elements, attrs = manifest_facts(apk.read("AndroidManifest.xml"))
        assert "uses-permission" not in elements
        assert attrs["package"][2] == "com.inori.hdquizstudy"
        assert attrs["versionCode"][1] == 10601
        assert attrs["versionName"][2] == "1.6.1"
        assert attrs["label"][2] == "华电离线刷题库"
        assert attrs["name"][2] in {"com.inori.hdquizstudy.StudyView", "android.intent.category.LAUNCHER"}
        assert attrs["usesCleartextTraffic"][1] == 0
        assert "supportsPictureInPicture" not in attrs or attrs["supportsPictureInPicture"][1] == 0
        assert apk.testzip() is None
        dex = b"".join(apk.read(name) for name in sorted(names) if name.endswith(".dex"))
        for marker in FORBIDDEN_DEX:
            assert marker not in dex, marker.decode()
        assert b"com/inori/hdquizstudy/StudyView" in dex
        assert b"requestWindowFeature" in dex
        exam0828 = json.loads(apk.read("assets/assets/data/exam0828.json"))
        assert len(exam0828["questions"]) == 270
        assert exam0828["title"] == "安规考试8.28题库"
        updated_group3 = next(
            question
            for question in exam0828["questions"]
            if question["chapter"] == "第3组"
            and question["section"] == "选择题"
            and question["number"] == 5
        )
        assert updated_group3["answer"] == "D"
        assert "安全标志" in updated_group3["stem"]
        safety_week_2 = json.loads(apk.read("assets/assets/data/safety-week2.json"))
        assert len(safety_week_2["questions"]) == 269
        assert safety_week_2["title"] == "第2周安规考试题库"
        assert safety_week_2["chapters"] == ["选择题", "填空题", "判断题"]
        assert safety_week_2["questions"][42]["answer"] == "C"
        assert safety_week_2["questions"][89]["answer"] == "防护装置"
        assert safety_week_2["questions"][268]["answer"] == "对"
        youth_theory_2 = json.loads(apk.read("assets/assets/data/youth-theory-2.json"))
        assert len(youth_theory_2["questions"]) == 580
        assert youth_theory_2["title"] == "青年理论知识网络学习竞赛题库（第二期）"
        assert len(youth_theory_2["chapters"]) == 7
        safety_2024_general = json.loads(apk.read("assets/assets/data/safety2024general.json"))
        assert len(safety_2024_general["questions"]) == 2262
        assert safety_2024_general["title"] == "2024版安规题库·通用部分"
        assert len(safety_2024_general["chapters"]) == 24
        safety_2024_coal = json.loads(apk.read("assets/assets/data/safety2024coal.json"))
        assert len(safety_2024_coal["questions"]) == 3207
        assert safety_2024_coal["title"] == "2024版安规题库·燃煤发电部分"
        assert len(safety_2024_coal["chapters"]) == 11
        index = apk.read("assets/index.html")
        main_js = apk.read("assets/main.js")
        core_js = apk.read("assets/core.js")
        styles = apk.read("assets/styles.css")
        embedded = apk.read("assets/banks-data.js")
        regulation_embedded = apk.read("assets/regulations-data.js")
        regulations = json.loads(apk.read("assets/assets/data/regulations.json"))
        assert b'banks-data.js' in index
        assert b'regulations-data.js' in index
        assert b'fetch(' not in main_js
        assert b'usesImmediateSubmission' in main_js
        assert b'correct && autoAdvance' in main_js
        assert b'CORRECT_FEEDBACK_DELAY_MS = 400' in main_js
        assert b'session.autoAdvancing = true' in main_js
        assert b'resumeSessions' in main_js
        assert '继续刷题'.encode() in main_js
        assert '指定题号'.encode() in main_js
        assert '题型刷题'.encode() in main_js
        assert '选择题型'.encode() in main_js
        assert b'matchesQuestionGroup' in main_js
        assert b'displayStart' in main_js
        assert b'displayTotal' in main_js
        assert b"fill-answer ${resultClass}" in main_js
        assert b".fill-answer.correct" in styles
        assert b".fill-answer.wrong" in styles
        for removed_copy in (b'STUDY DESK', b'CURRENT BANK', '把每一道错题'.encode(), '两个题库独立练习'.encode()):
            assert removed_copy not in main_js
        assert embedded.startswith(b'// Generated by scripts/embed_banks.py')
        assert b'"id":"safety2024general"' in embedded
        assert b'"id":"safety2024coal"' in embedded
        assert b'"id":"safetyweek2"' in embedded
        assert regulation_embedded.startswith(b'// Generated by scripts/embed_banks.py')
        assert b'"standard":"Q/CHD 85.1' in regulation_embedded
        assert b'"standard":"Q/CHD 85.2' in regulation_embedded
        assert [source["id"] for source in regulations["sources"]] == ["general", "coal"]
        assert len(regulations["clauses"]) > 3000
        assert any(entry["source"] == "general" and entry["ref"] == "3.1" for entry in regulations["clauses"])
        assert any(entry["source"] == "coal" and entry["ref"] == "4.1.1" for entry in regulations["clauses"])
        assert b"bankId === 'youththeory2'" in core_js
        assert '安规原文依据'.encode() in main_js
    print("Clean APK verified: zero permissions, five banks, 6588 questions, and two offline regulation sources.")


if __name__ == "__main__":
    main()
