#!/usr/bin/env python3
"""Build a minimal offline APK without a generic JavaScript bridge.

The delivery environment does not contain the Android SDK, so Java is compiled
against tiny compile-time-only Android stubs, converted to DEX with R8/D8, and
combined with a previously compiled resource template.  No stub class is added
to the APK.  The resulting application contains one Activity, one WebView, no
JavaScript interface and no effective network permission.
"""

from __future__ import annotations

import argparse
import shutil
import struct
import subprocess
import tempfile
import zipfile
from pathlib import Path


REPLACEMENTS = {
    "com.inori.wechataudio": "com.inori.hdquizstudy",
    "com.nicron.webview.MainActivity": "com.inori.hdquizstudy.StudyView",
    "android.permission.INTERNET": "com.inori.hdquizstudy.NOOPX",
    "公众号音频提取": "华电离线刷题库",
    "1.0.0": "1.6.1",
}


def run(*args: str | Path) -> None:
    subprocess.run([str(arg) for arg in args], check=True)


def replace_equal_utf16(data: bytes, old: str, new: str) -> bytes:
    old_bytes = old.encode("utf-16le")
    new_bytes = new.encode("utf-16le")
    if len(old_bytes) != len(new_bytes):
        raise ValueError(f"compiled string replacement must have equal length: {old!r} -> {new!r}")
    count = data.count(old_bytes)
    if count != 1:
        raise ValueError(f"expected one compiled string {old!r}, found {count}")
    return data.replace(old_bytes, new_bytes)


def parse_utf16_string_pool(data: bytes) -> tuple[dict[int, str], int]:
    offset = 8
    chunk_type, header_size, chunk_size = struct.unpack_from("<HHI", data, offset)
    if chunk_type != 0x0001:
        raise ValueError("binary manifest has no leading string pool")
    string_count, _style_count, flags, strings_start, _styles_start = struct.unpack_from("<IIIII", data, offset + 8)
    if flags & 0x100:
        raise ValueError("UTF-8 binary manifests are not supported by this patcher")
    offsets_base = offset + header_size
    strings_base = offset + strings_start
    values: dict[int, str] = {}
    for index in range(string_count):
        relative = struct.unpack_from("<I", data, offsets_base + index * 4)[0]
        cursor = strings_base + relative
        length = struct.unpack_from("<H", data, cursor)[0]
        if length & 0x8000:
            length = ((length & 0x7FFF) << 16) | struct.unpack_from("<H", data, cursor + 2)[0]
            cursor += 4
        else:
            cursor += 2
        values[index] = data[cursor:cursor + length * 2].decode("utf-16le")
    return values, offset + chunk_size


def disable_manifest_boole(data: bytes, names: set[str]) -> bytes:
    strings, cursor = parse_utf16_string_pool(data)
    mutable = bytearray(data)
    while cursor + 8 <= len(data):
        chunk_type, header_size, chunk_size = struct.unpack_from("<HHI", data, cursor)
        if chunk_size < 8:
            raise ValueError("invalid binary XML chunk size")
        if chunk_type == 0x0102:  # RES_XML_START_ELEMENT_TYPE
            attribute_start, attribute_size, attribute_count = struct.unpack_from("<HHH", data, cursor + 24)
            attributes = cursor + 16 + attribute_start
            for index in range(attribute_count):
                attribute = attributes + index * attribute_size
                name_index = struct.unpack_from("<I", data, attribute + 4)[0]
                if strings.get(name_index) in names:
                    data_type = data[attribute + 15]
                    if data_type != 0x12:  # TYPE_INT_BOOLEAN
                        raise ValueError(f"attribute {strings.get(name_index)} is not boolean")
                    struct.pack_into("<I", mutable, attribute + 16, 0)
        cursor += chunk_size
    return bytes(mutable)


def set_manifest_integer(data: bytes, name: str, value: int) -> bytes:
    strings, cursor = parse_utf16_string_pool(data)
    mutable = bytearray(data)
    updated = 0
    while cursor + 8 <= len(data):
        chunk_type, _header_size, chunk_size = struct.unpack_from("<HHI", data, cursor)
        if chunk_type == 0x0102:
            attribute_start, attribute_size, attribute_count = struct.unpack_from("<HHH", data, cursor + 24)
            attributes = cursor + 16 + attribute_start
            for index in range(attribute_count):
                attribute = attributes + index * attribute_size
                name_index = struct.unpack_from("<I", data, attribute + 4)[0]
                if strings.get(name_index) == name:
                    if data[attribute + 15] not in (0x10, 0x11):
                        raise ValueError(f"attribute {name} is not an integer")
                    struct.pack_into("<I", mutable, attribute + 16, value)
                    updated += 1
        cursor += chunk_size
    if updated != 1:
        raise ValueError(f"expected one {name} attribute, found {updated}")
    return bytes(mutable)


def remove_binary_xml_elements(data: bytes, names: set[str]) -> bytes:
    strings, cursor = parse_utf16_string_pool(data)
    output = bytearray(data[:cursor])
    remove_depth = 0
    removed = 0
    while cursor + 8 <= len(data):
        chunk_type, _header_size, chunk_size = struct.unpack_from("<HHI", data, cursor)
        if chunk_size < 8 or cursor + chunk_size > len(data):
            raise ValueError("invalid binary XML chunk")
        if chunk_type == 0x0102:  # start element
            element_name = strings.get(struct.unpack_from("<I", data, cursor + 20)[0])
            if remove_depth:
                remove_depth += 1
            elif element_name in names:
                remove_depth = 1
                removed += 1
            else:
                output.extend(data[cursor:cursor + chunk_size])
        elif chunk_type == 0x0103 and remove_depth:  # end element
            remove_depth -= 1
        elif not remove_depth:
            output.extend(data[cursor:cursor + chunk_size])
        cursor += chunk_size
    if remove_depth:
        raise ValueError("unterminated removed XML element")
    if removed != len(names):
        raise ValueError(f"expected to remove {len(names)} element(s), removed {removed}")
    struct.pack_into("<I", output, 4, len(output))
    return bytes(output)


def write_apk_entry(archive: zipfile.ZipFile, path: Path, name: str, compression: int) -> None:
    """Write an APK member, aligning uncompressed payloads to four bytes."""
    info = zipfile.ZipInfo.from_file(path, arcname=name)
    info.compress_type = compression
    if compression == zipfile.ZIP_STORED:
        encoded_name = name.encode("utf-8")
        data_offset = archive.fp.tell() + 30 + len(encoded_name)
        if data_offset % 4:
            payload_size = (-data_offset) % 4
            info.extra = struct.pack("<HH", 0xD935, payload_size) + (b"\0" * payload_size)
    archive.writestr(info, path.read_bytes(), compress_type=compression, compresslevel=9)


def compile_dex(project: Path, r8: Path, build: Path) -> Path:
    stubs = build / "stub-classes"
    classes = build / "app-classes"
    dex = build / "dex"
    stubs.mkdir(parents=True)
    classes.mkdir()
    dex.mkdir()
    stub_sources = sorted((project / "native-stubs").rglob("*.java"))
    app_sources = sorted((project / "native-src").rglob("*.java"))
    run("java", "-m", "jdk.compiler/com.sun.tools.javac.Main", "-source", "8", "-target", "8", "-d", stubs, *stub_sources)
    run("java", "-m", "jdk.compiler/com.sun.tools.javac.Main", "-source", "8", "-target", "8", "-classpath", stubs, "-d", classes, *app_sources)
    program_classes = sorted(classes.rglob("*.class"))
    run("java", "-cp", r8, "com.android.tools.r8.D8", "--min-api", "21", "--lib", stubs, "--output", dex, *program_classes)
    result = dex / "classes.dex"
    if not result.is_file():
        raise FileNotFoundError("D8 did not create classes.dex")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, default=Path.cwd())
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--r8", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    project = args.project.resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="huadian-clean-apk-") as temp:
        work = Path(temp)
        unpacked = work / "apk"
        unpacked.mkdir()
        with zipfile.ZipFile(args.template) as archive:
            for info in archive.infolist():
                if info.filename.startswith(("META-INF/", "assets/")) or info.filename == "classes.dex":
                    continue
                archive.extract(info, unpacked)

        manifest = unpacked / "AndroidManifest.xml"
        manifest_data = manifest.read_bytes()
        for old, new in REPLACEMENTS.items():
            manifest_data = replace_equal_utf16(manifest_data, old, new)
        manifest_data = set_manifest_integer(manifest_data, "versionCode", 10601)
        manifest_data = disable_manifest_boole(manifest_data, {"usesCleartextTraffic", "supportsPictureInPicture"})
        manifest_data = remove_binary_xml_elements(manifest_data, {"uses-permission"})
        manifest.write_bytes(manifest_data)

        shutil.copyfile(compile_dex(project, args.r8.resolve(), work / "compile"), unpacked / "classes.dex")
        shutil.copytree(project / "app", unpacked / "assets")
        icon = project / "app" / "assets" / "icon.png"
        for target in unpacked.glob("res/mipmap-*-v4/ic_launcher*.png"):
            shutil.copyfile(icon, target)

        with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path in sorted(unpacked.rglob("*")):
                if path.is_file():
                    name = path.relative_to(unpacked).as_posix()
                    # Modern Android requires the compiled manifest and resource
                    # table to be mmap-friendly: uncompressed and zip-aligned.
                    compression = zipfile.ZIP_STORED if name in {"AndroidManifest.xml", "resources.arsc"} else zipfile.ZIP_DEFLATED
                    write_apk_entry(archive, path, name, compression)
    print(args.output)


if __name__ == "__main__":
    main()
