#!/usr/bin/env python3
"""Add Runestone SPM package to WOTANN.xcodeproj — fixes iOS build.

Background: Package.swift declares Runestone as a dependency for the
WOTANNCore SPM target, but the actual Xcode app target (WOTANN.app) has
empty packageProductDependencies. Result: `xcodebuild` cannot resolve
`import Runestone` in EditorThemes.swift / RunestoneEditorView.swift.

This script patches the pbxproj to:
1. Add an XCRemoteSwiftPackageReference (the package URL + version pin).
2. Add an XCSwiftPackageProductDependency (the specific product).
3. Add a `packageReferences` array to the PBXProject root.
4. Add `packageProductDependencies` to the WOTANN app target.

Idempotent: skips if Runestone is already referenced.
"""
from __future__ import annotations
import sys
import re
from pathlib import Path

PBXPROJ = Path(__file__).resolve().parents[2] / "ios" / "WOTANN.xcodeproj" / "project.pbxproj"

# UUIDs — pre-generated; deterministic so re-runs touch the same lines.
PKG_REF_UUID = "62AA6155797545C5B5098F2B"     # XCRemoteSwiftPackageReference
PRODUCT_UUID = "7605EC65D6374E8CB2FA36BC"     # XCSwiftPackageProductDependency
FRAMEWORKS_PHASE_UUID = "7E1D71B5621848708B76AB11"   # PBXFrameworksBuildPhase
BUILD_FILE_UUID = "31A56FDCE6DC4BF496DF5E44"  # PBXBuildFile (Runestone in Frameworks)
WOTANN_TARGET_UUID = "8D63C446098A941773904477"  # PBXNativeTarget WOTANN

PACKAGE_URL = "https://github.com/simonbs/Runestone.git"
MIN_VERSION = "0.5.0"
PRODUCT_NAME = "Runestone"


def main() -> int:
    src = PBXPROJ.read_text(encoding="utf-8")
    if PKG_REF_UUID in src:
        print(f"[add-runestone] already patched (UUID {PKG_REF_UUID} present); no-op")
        return 0

    # 1. Insert XCRemoteSwiftPackageReference section just before
    #    /* End PBXProject section */ closes — pbxproj keeps each ISA
    #    type in its own labeled block, but the order of blocks is not
    #    enforced. We append a fresh block at end-of-file before the
    #    final `}` close.
    pkg_ref_block = (
        "\n/* Begin XCRemoteSwiftPackageReference section */\n"
        f"\t\t{PKG_REF_UUID} /* XCRemoteSwiftPackageReference \"{PRODUCT_NAME}\" */ = {{\n"
        "\t\t\tisa = XCRemoteSwiftPackageReference;\n"
        f"\t\t\trepositoryURL = \"{PACKAGE_URL}\";\n"
        "\t\t\trequirement = {\n"
        "\t\t\t\tkind = upToNextMajorVersion;\n"
        f"\t\t\t\tminimumVersion = {MIN_VERSION};\n"
        "\t\t\t};\n"
        "\t\t};\n"
        "/* End XCRemoteSwiftPackageReference section */\n"
    )

    product_block = (
        "\n/* Begin XCSwiftPackageProductDependency section */\n"
        f"\t\t{PRODUCT_UUID} /* {PRODUCT_NAME} */ = {{\n"
        "\t\t\tisa = XCSwiftPackageProductDependency;\n"
        f"\t\t\tpackage = {PKG_REF_UUID} /* XCRemoteSwiftPackageReference \"{PRODUCT_NAME}\" */;\n"
        f"\t\t\tproductName = {PRODUCT_NAME};\n"
        "\t\t};\n"
        "/* End XCSwiftPackageProductDependency section */\n"
    )

    # Frameworks build phase — required so Swift compiler can SEE the
    # module map. Without it, packageProductDependencies alone tells
    # Xcode "this target depends on this product" but the swiftc
    # invocation never gets the `-I path/to/Runestone.framework` flag,
    # producing the misleading "Unable to resolve module dependency"
    # error even though the package is fully resolved on disk.
    frameworks_phase_block = (
        "\n/* Begin PBXFrameworksBuildPhase section */\n"
        f"\t\t{FRAMEWORKS_PHASE_UUID} /* Frameworks */ = {{\n"
        "\t\t\tisa = PBXFrameworksBuildPhase;\n"
        "\t\t\tbuildActionMask = 2147483647;\n"
        "\t\t\tfiles = (\n"
        f"\t\t\t\t{BUILD_FILE_UUID} /* {PRODUCT_NAME} in Frameworks */,\n"
        "\t\t\t);\n"
        "\t\t\trunOnlyForDeploymentPostprocessing = 0;\n"
        "\t\t};\n"
        "/* End PBXFrameworksBuildPhase section */\n"
    )

    # PBXBuildFile entry that links the SPM product into the Frameworks
    # build phase. Goes in the existing PBXBuildFile section.
    build_file_block = (
        f"\t\t{BUILD_FILE_UUID} /* {PRODUCT_NAME} in Frameworks */ = "
        f"{{isa = PBXBuildFile; productRef = {PRODUCT_UUID} /* {PRODUCT_NAME} */; }};\n"
    )

    # Append the new sections at the bottom of the objects dictionary.
    # The pbxproj structure is:
    #   { archiveVersion=1; ... objects = { ... }; rootObject=...; }
    # The closing `\t};\n` of the objects dict is followed by a blank
    # line and then `\trootObject = ...;`. New sections MUST go BEFORE
    # that closing brace so Xcode sees them inside `objects`.
    objects_close_marker = "\t};\n\trootObject = "
    if objects_close_marker not in src:
        print("[add-runestone] ERROR: cannot find objects-dict close marker", file=sys.stderr)
        return 1
    src = src.replace(
        objects_close_marker,
        pkg_ref_block + product_block + frameworks_phase_block + objects_close_marker,
        1,
    )

    # Insert PBXBuildFile entry inside the existing PBXBuildFile section.
    # Anchor on the first existing PBXBuildFile line so we land inside
    # the section. Use an anchor that's stable: the section header.
    buildfile_section_marker = "/* Begin PBXBuildFile section */\n"
    if buildfile_section_marker not in src:
        print(
            "[add-runestone] ERROR: cannot find PBXBuildFile section header",
            file=sys.stderr,
        )
        return 5
    src = src.replace(
        buildfile_section_marker,
        buildfile_section_marker + build_file_block,
        1,
    )

    # Add the Frameworks build phase to the WOTANN target's buildPhases.
    # The target currently has 3 phases (Sources, Resources, Embed); we
    # insert Frameworks after Sources so the linker step happens before
    # the Resources copy.
    target_buildphases_marker = (
        "\t\t\tbuildPhases = (\n"
        "\t\t\t\tC6035D241C600C863AB0FD65 /* Sources */,\n"
    )
    if target_buildphases_marker not in src:
        print(
            "[add-runestone] ERROR: cannot find WOTANN target's Sources buildPhase",
            file=sys.stderr,
        )
        return 6
    src = src.replace(
        target_buildphases_marker,
        target_buildphases_marker
        + f"\t\t\t\t{FRAMEWORKS_PHASE_UUID} /* Frameworks */,\n",
        1,
    )

    # 2. Add `packageReferences` array to PBXProject. Insert it after
    #    the `mainGroup = ...;` line (always present in a valid pbxproj).
    proj_marker = "\t\t\tmainGroup = 1B31F7EBAF893729C6723F2B;\n"
    if proj_marker not in src:
        print("[add-runestone] ERROR: cannot find mainGroup marker", file=sys.stderr)
        return 2
    pkg_refs_lines = (
        "\t\t\tpackageReferences = (\n"
        f"\t\t\t\t{PKG_REF_UUID} /* XCRemoteSwiftPackageReference \"{PRODUCT_NAME}\" */,\n"
        "\t\t\t);\n"
    )
    src = src.replace(proj_marker, proj_marker + pkg_refs_lines, 1)

    # 3. Add WOTANN target's packageProductDependencies. The target's
    #    block declares `packageProductDependencies = ();` (empty).
    #    Replace empty form with one containing Runestone.
    target_marker = (
        f"\t\t{WOTANN_TARGET_UUID} /* WOTANN */ = {{\n"
        "\t\t\tisa = PBXNativeTarget;\n"
    )
    if target_marker not in src:
        print("[add-runestone] ERROR: cannot find WOTANN target", file=sys.stderr)
        return 3

    # Find the empty packageProductDependencies line that belongs to
    # the WOTANN target — pbxproj has six such empties (one per target),
    # so we anchor on the WOTANN target's productName line that follows.
    wotann_block_start = src.index(target_marker)
    wotann_block_end = src.index(
        "\t\t};\n",
        wotann_block_start,
    ) + len("\t\t};\n")
    wotann_block = src[wotann_block_start:wotann_block_end]

    new_wotann_block = wotann_block.replace(
        "\t\t\tpackageProductDependencies = (\n\t\t\t);\n",
        "\t\t\tpackageProductDependencies = (\n"
        f"\t\t\t\t{PRODUCT_UUID} /* {PRODUCT_NAME} */,\n"
        "\t\t\t);\n",
        1,
    )
    if new_wotann_block == wotann_block:
        print(
            "[add-runestone] ERROR: WOTANN target has no empty"
            " packageProductDependencies — manual fix needed",
            file=sys.stderr,
        )
        return 4
    src = src.replace(wotann_block, new_wotann_block, 1)

    PBXPROJ.write_text(src, encoding="utf-8")
    print(f"[add-runestone] patched: added Runestone SPM to WOTANN target")
    print(f"[add-runestone] PKG_REF_UUID = {PKG_REF_UUID}")
    print(f"[add-runestone] PRODUCT_UUID = {PRODUCT_UUID}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
