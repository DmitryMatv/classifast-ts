"""Export golden fixtures that pin the TypeScript ports to the Python reference.

Usage:
    python utilities/export_golden_fixtures.py

Writes test/fixtures/golden/id-lookup.json. Rerun it after changing
app/id_lookup.py and commit the regenerated fixture.
"""

import json
import os
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.id_lookup import normalize_original_id_for_lookup, reverse_normalized_id

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_PATH = REPO_ROOT / "test" / "fixtures" / "golden" / "id-lookup.json"
ASCII_ALNUM = re.compile(r"[0-9A-Za-z]")

ID_INPUTS = [
    "",
    " ",
    "0",
    "00",
    "000000000",
    "100",
    "001",
    "10101",
    "EC000123",
    "ec000123",
    "EC-000-123",
    "  ec 000 123  ",
    "03111000-2",
    "03111000",
    "031110002",
    "031110020",
    "031110000",
    "131110002",
    "03111000-20",
    "0311100-2",
    "003111000-2",
    "0000000012",
    "000000102",
    "000000002",
    "100000002",
    "43211503",
    "4321.15.03",
    "0101.21.00",
    "8471.30.0100",
    "A01.1.1",
    "a01.1.1",
    "C10.1",
    "62.01",
    "541511",
    "2042-00-123-4567",
    "5965-01-234-5678",
    "10003847",
    "EC_000_123",
    "ec/000\\123",
    "(045)",
    "#1!@#$%^&*()",
    "tab\tnew\nline\rcr",
    "\u00a0031\u2007110\u200b002",
    "STRASSE",
    "Stra\u00dfe",
    "STRA\u1e9eE",
    "\u00df",
    "\u1e9e",
    "\u017f",
    "\u0130stanbul",
    "ISTANBUL",
    "\u0131i",
    "I\u0131",
    "\u03a3\u038a\u03a3\u03a5\u03a6\u039f\u03a3",
    "\u03c3\u03c2",
    "\ufb0101",
    "\ufb00-\ufb04",
    "\ufb05\ufb06",
    "\u0149",
    "\u01f0",
    "\u1e96\u1e97\u1e98\u1e99\u1e9a",
    "\u212a12",
    "\u00c51",
    "\uff21\uff22\uff23\uff11\uff12\uff13",
    "\u041a\u043e\u0434-123",
    "\u041e\u041a\u041f\u0414 01.11.11",
    "\u5546\u54c1\u7f16\u7801 8471",
    "\u5206\u985e\uff10\uff11\uff12",
    "\u30b3\u30fc\u30c9-0012",
    "\U0001f600",
    "\U0001f600123\U0001f600",
    "\U0001f44d\U0001f3fd-007",
    "\u00e9clair",
    "e\u0301clair",
    "\u00c4",
    "A\u0308",
    "\u216b",
    "\u2460\u2461\u2462",
    "\u0660\u0661\u0662\u0663",
    "\u0661\u0662\u0663abc",
    "x\u00b2",
    "0x1F",
    "\u01c4",
    "\u01c5",
]

# JSON text, as Qdrant returns a non-string original_id payload. The text
# keeps 12.0 apart from 12, which JSON.parse cannot.
PAYLOAD_ID_JSON_INPUTS = [
    "true",
    "false",
    "4300",
    "-4300",
    "12.0",
    "-12.0",
    "12.5",
    "-12.5",
    "101.21",
    "4321.1503",
    "0.10203004",
    "0.0001",
    "1e-4",
    "999999999999999.9",
    "1000000000000000.0",
    "9007199254740991",
    "0",
    "0.0",
    "-0.0",
    "0.00001",
    "1e16",
    "9007199254740993",
    "1.5e300",
    '["A", 1]',
    '{"a": 1}',
]

REVERSE_INPUTS = [
    "",
    "a",
    "ab",
    "3111002",
    "ec000123",
    "ab\U0001f600cd",
    "e\u0301x",
    "\u5546\u54c1\u7f16\u7801",
    "\U0001f468\u200d\U0001f469",
]


def non_ascii_code_points_with_ascii_folds() -> list[dict[str, object]]:
    folds = []
    for code_point in range(0x80, 0x110000):
        if 0xD800 <= code_point <= 0xDFFF:
            continue
        character = chr(code_point)
        if ASCII_ALNUM.search(character.casefold()):
            folds.append(
                {
                    "codePoint": code_point,
                    "normalized": normalize_original_id_for_lookup(character),
                }
            )
    return folds


def build_fixture() -> dict[str, object]:
    return {
        "unicodeVersion": unicodedata.unidata_version,
        "normalize": [
            {"input": value, "normalized": normalize_original_id_for_lookup(value)}
            for value in [*ID_INPUTS, *(chr(code_point) for code_point in range(128))]
        ],
        "payloadIds": [
            {
                "json": text,
                "normalized": normalize_original_id_for_lookup(json.loads(text)),
            }
            for text in PAYLOAD_ID_JSON_INPUTS
        ],
        "reverse": [
            {"input": value, "reversed": reverse_normalized_id(value)}
            for value in REVERSE_INPUTS
        ],
        "nonAsciiFolds": non_ascii_code_points_with_ascii_folds(),
    }


def main() -> None:
    # Editors and agent tools may NFC-normalize non-ASCII literals, which
    # silently changes inputs such as U+212A or e + U+0301. Escape them.
    if not Path(__file__).read_bytes().isascii():
        sys.exit("Write non-ASCII inputs as escapes in export_golden_fixtures.py")
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(
        json.dumps(build_fixture(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {FIXTURE_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
