#!/usr/bin/env python3
"""Add a Swift source file to the WOTANN Xcode target.

Adds 4 entries to project.pbxproj using a sibling file as anchor:
  1. PBXBuildFile  (links the file in the Sources build phase)
  2. PBXFileReference  (declares the file's path)
  3. PBXGroup child  (places the file in the project navigator)
  4. PBXSourcesBuildPhase entry  (runs the file through the compiler)

Usage:
    python3 add-source-file.py NEW_FILE.swift ANCHOR_FILE.swift

The anchor file MUST already be in pbxproj. The new file is added
right after the anchor in all 4 sections so navigator order is sane.
Idempotent: skips if NEW_FILE is already referenced.
"""
from __future__ import annotations
import sys
import re
import uuid
from pathlib import Path

PBXPROJ = Path(__file__).resolve().parents[2] / "ios" / "WOTANN.xcodeproj" / "project.pbxproj"


def gen_uuid() -> str:
    return uuid.uuid4().hex[:24].upper()


def main() -> int:
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} NEW_FILE.swift ANCHOR_FILE.swift", file=sys.stderr)
        return 64
    new_name = sys.argv[1]
    anchor_name = sys.argv[2]

    src = PBXPROJ.read_text(encoding="utf-8")
    if new_name in src:
        print(f"[add-source-file] {new_name} already in pbxproj — no-op")
        return 0

    # Find anchor entries
    bf_pattern = rf"\t\t([0-9A-F]{{24}}) /\* {re.escape(anchor_name)} in Sources \*/ = \{{isa = PBXBuildFile; fileRef = ([0-9A-F]{{24}}) /\* {re.escape(anchor_name)} \*/; \}};"
    bf_match = re.search(bf_pattern, src)
    if not bf_match:
        print(f"[add-source-file] ERROR: anchor {anchor_name} PBXBuildFile not found", file=sys.stderr)
        return 1
    anchor_bf_uuid = bf_match.group(1)
    anchor_fr_uuid = bf_match.group(2)

    new_bf_uuid = gen_uuid()
    new_fr_uuid = gen_uuid()

    # 1. PBXBuildFile entry — append after anchor
    new_bf = f"\t\t{new_bf_uuid} /* {new_name} in Sources */ = {{isa = PBXBuildFile; fileRef = {new_fr_uuid} /* {new_name} */; }};\n"
    src = src.replace(bf_match.group(0) + "\n", bf_match.group(0) + "\n" + new_bf, 1)

    # 2. PBXFileReference entry — append after anchor
    fr_pattern = rf"\t\t{anchor_fr_uuid} /\* {re.escape(anchor_name)} \*/ = \{{isa = PBXFileReference; lastKnownFileType = sourcecode\.swift; path = {re.escape(anchor_name)}; sourceTree = \"<group>\"; \}};"
    fr_match = re.search(fr_pattern, src)
    if not fr_match:
        print(f"[add-source-file] ERROR: anchor {anchor_name} PBXFileReference not found", file=sys.stderr)
        return 2
    new_fr = f"\t\t{new_fr_uuid} /* {new_name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {new_name}; sourceTree = \"<group>\"; }};\n"
    src = src.replace(fr_match.group(0) + "\n", fr_match.group(0) + "\n" + new_fr, 1)

    # 3. PBXGroup child line — append after anchor in the same group
    group_child_marker = f"\t\t\t\t{anchor_fr_uuid} /* {anchor_name} */,\n"
    if group_child_marker not in src:
        print(f"[add-source-file] ERROR: anchor {anchor_name} group child not found", file=sys.stderr)
        return 3
    new_group_child = f"\t\t\t\t{new_fr_uuid} /* {new_name} */,\n"
    src = src.replace(group_child_marker, group_child_marker + new_group_child, 1)

    # 4. PBXSourcesBuildPhase entry — append after anchor
    sources_marker = f"\t\t\t\t{anchor_bf_uuid} /* {anchor_name} in Sources */,\n"
    if sources_marker not in src:
        print(f"[add-source-file] ERROR: anchor {anchor_name} Sources phase entry not found", file=sys.stderr)
        return 4
    new_sources_entry = f"\t\t\t\t{new_bf_uuid} /* {new_name} in Sources */,\n"
    src = src.replace(sources_marker, sources_marker + new_sources_entry, 1)

    PBXPROJ.write_text(src, encoding="utf-8")
    print(f"[add-source-file] added {new_name}")
    print(f"[add-source-file] BuildFile UUID = {new_bf_uuid}")
    print(f"[add-source-file] FileRef UUID = {new_fr_uuid}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
