"""Guard against duplicate YAML keys in the Home Assistant config files.

PyYAML — like Home Assistant's own loader — silently keeps only the *last* of
any duplicated mapping keys. That means a second top-level ``input_boolean:``
block quietly wipes out the first one with no error, dropping every entity it
defined (this actually happened and broke the notifications toggle, V2G mode,
the smart sockets, etc.).

These tests walk every ``config/*.yaml`` file and fail loudly if any mapping —
at any nesting level — has a repeated key.

We use ``yaml.compose_all`` (which builds the node graph *without* constructing
Python objects) so Home Assistant's custom tags like ``!include`` and
``!include_dir_merge_named`` don't need constructors and don't trip the parser.
"""
from io import StringIO
from pathlib import Path

import pytest
import yaml
from yaml.nodes import MappingNode, SequenceNode

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"


def _duplicate_keys(stream) -> list[tuple[str, int]]:
    """Return (key, line) for every duplicated mapping key found in a YAML stream."""
    dups: list[tuple[str, int]] = []

    def walk(node) -> None:
        if isinstance(node, MappingNode):
            seen: set[str] = set()
            for key_node, value_node in node.value:
                key = str(getattr(key_node, "value", ""))
                if key in seen:
                    dups.append((key, key_node.start_mark.line + 1))
                seen.add(key)
                walk(value_node)
        elif isinstance(node, SequenceNode):
            for item in node.value:
                walk(item)

    for doc in yaml.compose_all(stream):
        if doc is not None:
            walk(doc)
    return dups


def _config_files() -> list[Path]:
    return sorted(CONFIG_DIR.glob("*.yaml"))


def test_config_dir_exists_and_has_yaml() -> None:
    assert CONFIG_DIR.is_dir(), f"config dir not found: {CONFIG_DIR}"
    assert _config_files(), "no config/*.yaml files found"


@pytest.mark.parametrize("path", _config_files(), ids=lambda p: p.name)
def test_no_duplicate_keys(path: Path) -> None:
    with open(path, encoding="utf-8") as f:
        dups = _duplicate_keys(f)
    assert not dups, "duplicate YAML keys in {}:\n{}".format(
        path.name,
        "\n".join(f"  - '{k}' (line {ln})" for k, ln in dups),
    )


# ── the detector itself ──────────────────────────────────────────────────────


def test_detector_flags_a_top_level_duplicate() -> None:
    doc = "input_boolean:\n  a:\n    name: A\ninput_boolean:\n  b:\n    name: B\n"
    dups = _duplicate_keys(StringIO(doc))
    assert ("input_boolean", 4) in dups


def test_detector_flags_a_nested_duplicate() -> None:
    doc = "top:\n  child: 1\n  child: 2\n"
    dups = _duplicate_keys(StringIO(doc))
    assert [k for k, _ in dups] == ["child"]


def test_detector_tolerates_ha_custom_tags() -> None:
    # !include / !secret must not raise — compose never constructs them.
    doc = "automation: !include automations.yaml\nsecret: !secret token\n"
    assert _duplicate_keys(StringIO(doc)) == []


def test_detector_passes_clean_mapping() -> None:
    doc = "a: 1\nb: 2\nc:\n  d: 3\n  e: 4\n"
    assert _duplicate_keys(StringIO(doc)) == []
