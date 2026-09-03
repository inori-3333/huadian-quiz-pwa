#!/usr/bin/env python3
"""Apply Android's four-byte alignment rule without changing APK contents."""

from __future__ import annotations

import argparse
import os
import struct
import tempfile
import zipfile
from pathlib import Path


ALIGNMENT_EXTRA_ID = 0xD935


def without_alignment_extra(extra: bytes) -> bytes:
    output = bytearray()
    cursor = 0
    while cursor + 4 <= len(extra):
        field_id, size = struct.unpack_from("<HH", extra, cursor)
        end = cursor + 4 + size
        if end > len(extra):
            return extra
        if field_id != ALIGNMENT_EXTRA_ID:
            output.extend(extra[cursor:end])
        cursor = end
    if cursor != len(extra):
        return extra
    return bytes(output)


def clone_info(info: zipfile.ZipInfo) -> zipfile.ZipInfo:
    cloned = zipfile.ZipInfo(info.filename, info.date_time)
    for name in (
        "comment", "create_system", "create_version", "extract_version", "reserved",
        "flag_bits", "volume", "internal_attr", "external_attr",
    ):
        setattr(cloned, name, getattr(info, name))
    cloned.compress_type = info.compress_type
    cloned.extra = without_alignment_extra(info.extra)
    return cloned


def align_apk(source: Path, destination: Path) -> None:
    with zipfile.ZipFile(source) as incoming, zipfile.ZipFile(
        destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as outgoing:
        outgoing.comment = incoming.comment
        for original in incoming.infolist():
            info = clone_info(original)
            if info.compress_type == zipfile.ZIP_STORED:
                encoded_name = info.filename.encode("utf-8")
                data_offset = outgoing.fp.tell() + 30 + len(encoded_name) + len(info.extra)
                if data_offset % 4:
                    payload_size = (-data_offset) % 4
                    info.extra += struct.pack("<HH", ALIGNMENT_EXTRA_ID, payload_size) + (b"\0" * payload_size)
            outgoing.writestr(
                info,
                incoming.read(original.filename),
                compress_type=info.compress_type,
                compresslevel=9,
            )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    source = args.apk.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)

    if args.output:
        destination = args.output.resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        align_apk(source, destination)
    else:
        with tempfile.NamedTemporaryFile(prefix=f"{source.stem}-", suffix=".apk", dir=source.parent, delete=False) as handle:
            temporary = Path(handle.name)
        try:
            align_apk(source, temporary)
            os.replace(temporary, source)
        finally:
            temporary.unlink(missing_ok=True)
        destination = source
    print(destination)


if __name__ == "__main__":
    main()
