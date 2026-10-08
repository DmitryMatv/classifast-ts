"""Export golden fixtures that pin the TypeScript ports to the Python reference.

Usage:
    python utilities/export_golden_fixtures.py

Writes one JSON file per area to test/fixtures/golden/. Rerun it after
changing a function it exports, or the Python version, and commit the
regenerated fixtures.
"""

import json
import math
import os
import random
import re
import sys
import unicodedata
from collections.abc import Callable
from pathlib import Path
from urllib.parse import quote, quote_plus, unquote, unquote_plus, urlencode

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import dotenv
from jinja2 import Template

# app.classifier_config calls load_dotenv() at import. The fixtures must not
# depend on a developer's .env, so the exporter never loads one.
dotenv.load_dotenv = lambda *args, **kwargs: False

from fastapi import HTTPException

from app.classifier import (
    QueryFormat,
    _default_rerank_document,
    build_query_embedding_text,
    build_rerank_query_text,
    sanitize_query_text,
)
from app.classifier_config import CLASSIFIER_CONFIG
from app.classifier_page_delivery import (
    SITEMAP_QUERY_PATHS,
    build_classifier_canonical_url,
    build_classifier_redirect_url,
    build_fragment_page_title,
    build_fragment_push_url,
    decode_search_query,
    get_classifier_or_404,
    normalize_product_description,
    resolve_classifier_options,
    should_ssr,
    slugify,
)
from app.dependencies import group_original_id_tokens, templates
from app.id_lookup import normalize_original_id_for_lookup, reverse_normalized_id
from app.query_enhancer import _is_code_like

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = REPO_ROOT / "test" / "fixtures" / "golden"
ASCII_ALNUM = re.compile(r"[0-9A-Za-z]")
CODE_POINTS = [
    code_point for code_point in range(0x110000) if not 0xD800 <= code_point <= 0xDFFF
]

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


def build_id_lookup_fixture() -> dict[str, object]:
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


TEXT_INPUTS = [
    "",
    " ",
    "a",
    "ab",
    "Laptop computer",
    "laptop_computer",
    "LED lamp",
    "office-chair",
    "IT services",
    "  multiple   spaces\tand\ttabs\nnew lines  ",
    "\u041d\u043e\u0443\u0442\u0431\u0443\u043a Lenovo ThinkPad",
    "\u043a\u043e\u0444\u0435 \u0432 \u0437\u0451\u0440\u043d\u0430\u0445",
    "\u5546\u54c1\u7f16\u7801 8471 \u7b14\u8bb0\u672c\u7535\u8111",
    "\u30ce\u30fc\u30c8\u30d1\u30bd\u30b3\u30f3",
    "\ub178\ud2b8\ubd81 \ucef4\ud4e8\ud130",
    "\U0001f600 smiley face",
    "\U0001f468\u200d\U0001f469\u200d\U0001f467 family",
    "\U0001f1e9\U0001f1ea flag",
    "\U0001f44d\U0001f3fd thumbs",
    "caf\u00e9 \u00e9clair",
    "cafe\u0301 e\u0301clair",
    "Stra\u00dfe",
    "STRASSE",
    "\u00df",
    "\u1e9e",
    "\u0130stanbul",
    "\u0131i",
    "I\u011eDIR i\u011fdir",
    "\u00a0nbsp\u00a0value\u00a0",
    "line\u2028separator",
    "para\u2029separator",
    "\x1cfile\x1dgroup\x1erecord\x1funit",
    "\x85next line\x85",
    "\ufeffbom\ufeff",
    "zero\u200bwidth",
    "\u3000ideographic\u3000space\u3000",
    "\u2007figure\u202fnarrow",
    "\x0bvertical\x0cform",
    "%20encoded%20space",
    "%2520double",
    "%252520triple",
    "100%",
    "%E2%9C%93 check",
    "%C3%A9t%C3%A9",
    "%C3",
    "%zz",
    "%",
    "a+b",
    "a%2Bb",
    "%F0%9F%98%80",
    "%ED%A0%80",
    "03111000-2",
    "CPV 03111000-2",
    "4321.15.03",
    "8471.30.0100",
    "EC000123",
    "A01.1.1",
    "5965-01-234-5678",
    "they're o'neill's",
    "hello-world",
    "3rd-party 2nd",
    "x\u00b2 \u2460\u2461 \u0660\u0661\u0662\u0663 \u216b",
    "\ufb01ne \ufb02our",
    "\u01c6ungla \u01c8udi",
    "\u03a3\u038a\u03a3\u03a5\u03a6\u039f\u03a3",
    "\u1f48\u0394\u03a5\u03a3\u03a3\u0395\u038e\u03a3",
    "\u1fb3 \u1f80",
    "\u0149 \u01f0",
    "\u10d5\u10d4\u10e4\u10ee\u10d8\u10e1\u10e2\u10e7\u10d0\u10dd\u10e1\u10d0\u10dc\u10d8",
    "<script>alert(1)</script>",
    "a/b/c",
    "trailing///",
    "under_score__double",
    "(parens) [brackets] {braces}",
    "quotes \"double\" 'single'",
    "a&b=c#d!e@f",
    "semi;colon:comma,dot.",
    "back\\slash",
    "tilde~`grave",
    "dead beef cafe babe",
    "deadbeefcafe0123",
    "252525",
    "a\x00nul",
    "Industrial pump with stainless steel housing " * 120,
    "\U0001f600" * 250,
    "ab" + "\u0301" * 300,
    "x" * 4000,
    "x" * 4001,
    "\U0001f600" * 2001,
    "\U00020000" * 150,
    "\U00020000" * 2500 + " tail",
]

# Length limits matter only to the functions that slice or reject long text.
SHORT_TEXT_INPUTS = [value for value in TEXT_INPUTS if len(value) <= 100]

TITLE_INPUTS = [
    "hello world",
    "HELLO WORLD",
    "they're bill's friends",
    "3rd party 2nd 1st",
    "laptop-computer/desktop_computer",
    "\u03a3",
    "\u03a3\u03a3",
    "a\u03a3",
    "a\u03a3b",
    "A\u03a3'",
    "A\u03a3'b",
    "A\u03a3.",
    "\u02b0\u03a3",
    "1\u02b0\u03a3",
    "\u00e1\u03a3",
    "a\u0345\u03a3",
    "\u0130\u0130",
    "a\u0130",
    "\u01c5\u01c4\u01c6",
    "a\u01c4",
    "\u1f80\u1f80 \u1fb2\u1fb7",
    "\u0587\u0587",
]


def code_point_ranges(predicate: Callable[[str], bool]) -> list[str]:
    ranges: list[list[int]] = []
    for code_point in CODE_POINTS:
        if not predicate(chr(code_point)):
            continue
        if ranges and ranges[-1][1] == code_point - 1:
            ranges[-1][1] = code_point
        else:
            ranges.append([code_point, code_point])
    return [
        f"{start:04X}" if start == end else f"{start:04X}-{end:04X}"
        for start, end in ranges
    ]


def code_point_map(mapper: Callable[[str], str | None]) -> dict[str, str]:
    mapped = {}
    for code_point in CODE_POINTS:
        value = mapper(chr(code_point))
        if value is not None:
            mapped[f"{code_point:04X}"] = value
    return mapped


def is_cased(character: str) -> bool:
    # str.title() lowercases a letter that follows a cased character.
    return ("1" + character + "a").title().endswith("a")


def is_case_ignorable(character: str) -> bool:
    # Capital sigma lowercases to final sigma unless a cased character
    # follows it past any case-ignorable ones.
    if is_cased(character):
        return ("A\u03a3" + character).lower()[1] == "\u03c2"
    return ("A\u03a3" + character + "A").lower()[1] == "\u03c3"


def build_python_str_fixture() -> dict[str, object]:
    whitespace = code_point_ranges(str.isspace)
    assert whitespace == code_point_ranges(
        lambda character: re.fullmatch(r"\s", character) is not None
    ), "re \\s and str.isspace disagree"
    assert whitespace == code_point_ranges(
        lambda character: ("a" + character).strip() == "a"
    ), "str.strip and str.isspace disagree"
    return {
        "unicodeVersion": unicodedata.unidata_version,
        "unassignedRanges": code_point_ranges(
            lambda character: unicodedata.category(character) == "Cn"
        ),
        "whitespaceRanges": whitespace,
        "wordRanges": code_point_ranges(
            lambda character: re.fullmatch(r"\w", character) is not None
        ),
        "decimalRanges": code_point_ranges(
            lambda character: re.fullmatch(r"\d", character) is not None
        ),
        "alphaRanges": code_point_ranges(str.isalpha),
        "digitRanges": code_point_ranges(str.isdigit),
        "casedRanges": code_point_ranges(is_cased),
        "caseIgnorableRanges": code_point_ranges(is_case_ignorable),
        "upperMappings": code_point_map(
            lambda character: (
                upper if (upper := character.upper()) != character else None
            )
        ),
        "titleMappings": code_point_map(
            lambda character: (
                title if (title := character.title()) != character.upper() else None
            )
        ),
        "title": [
            {"input": value, "title": value.title()}
            for value in [*SHORT_TEXT_INPUTS, *TITLE_INPUTS]
        ],
        "upper": [
            {"input": value, "upper": value.upper()} for value in SHORT_TEXT_INPUTS
        ],
        "strip": [
            {"input": value, "stripped": value.strip()} for value in SHORT_TEXT_INPUTS
        ],
    }


QUOTE_SAFE_SETS = ["", "/", "()*,:"]
PERCENT_SWEEP_SECOND_BYTES = [0x41, 0x80, 0x8F, 0x90, 0x9F, 0xA0, 0xBF, 0xC0]


def percent_sweep_inputs() -> list[str]:
    inputs = [f"%{byte:02X}" for byte in range(256)]
    inputs += [f"%{byte:02x}" for byte in range(0x80, 0x100, 0x11)]
    for lead in range(0x80, 0x100):
        for second in PERCENT_SWEEP_SECOND_BYTES:
            inputs.append(f"%{lead:02X}%{second:02X}")
            inputs.append(f"%{lead:02X}%{second:02X}%80%80")
    return inputs


UNQUOTE_INPUTS = [
    *SHORT_TEXT_INPUTS,
    "%41%42%43",
    "%4",
    "%4g",
    "%%41",
    "%C3%A9%C3",
    "\u00e9%C3%A9",
    "%C3\u00e9%A9",
    "%E2%82",
    "%E2%82%AC",
    "%F0%9F%98",
    "%F4%90%80%80",
    "%C0%AF",
    "+%2B+",
    "%EF%BB%BFbom",
    "\u00e9%EF%BB%BF",
    "a%2Fb",
]

URLENCODE_INPUTS = [
    [],
    [["version", "CPV 2008 (ver. 2013)"]],
    [["version", "HS6 2022"], ["top_k", "25"], ["enhance_query", "1"]],
    [["q", "a&b=c+d/\u00e9\U0001f600"], ["empty", ""]],
    [["key with space", "~*'()!"]],
]


def build_python_urllib_fixture() -> dict[str, object]:
    quote_inputs = [*SHORT_TEXT_INPUTS, *(chr(code_point) for code_point in range(128))]
    return {
        "quote": [
            {"input": value, "safe": safe, "quoted": quote(value, safe=safe)}
            for safe in QUOTE_SAFE_SETS
            for value in quote_inputs
        ],
        "quotePlus": [
            {"input": value, "quoted": quote_plus(value, safe="")}
            for value in quote_inputs
        ],
        "unquote": {
            value: unquote(value)
            for value in [*UNQUOTE_INPUTS, *percent_sweep_inputs()]
        },
        "unquotePlus": {value: unquote_plus(value) for value in UNQUOTE_INPUTS},
        "urlencode": [
            {"pairs": pairs, "encoded": urlencode([tuple(pair) for pair in pairs])}
            for pairs in URLENCODE_INPUTS
        ],
    }


NUMBER_INPUTS = [
    "",
    " ",
    "0",
    "-0",
    "+0",
    "007",
    "10",
    "-10",
    "+10",
    "  42  ",
    "\t42\n",
    "\x0b42\x0c",
    "\x1c42",
    "42\x1f",
    "\x8542\x85",
    "\u00a042\u3000",
    "\u200b42",
    "\ufeff42",
    "4 2",
    "1_000",
    "1__000",
    "_1000",
    "1000_",
    "+_1",
    "-1_0",
    "1_0.5",
    "1._5",
    "1_.5",
    "1e1_0",
    "1_e5",
    "1e_5",
    "0x10",
    "0o17",
    "0b11",
    "1.0",
    "1.",
    ".5",
    ".",
    "5e3",
    "5E+3",
    "5e-3",
    "-.5e-3",
    "1e",
    "e5",
    "1e500",
    "-1e500",
    "1e-400",
    "inf",
    "-Inf",
    "+INFINITY",
    "infinit",
    "nan",
    "-NaN",
    "nan1",
    "Infinity",
    "9007199254740993",
    "123456789012345678901234567890",
    "1" * 4300,
    "1" * 4301,
    "0.1",
    "2.675",
    "0.30000000000000004",
    "\u0661\u0662",
    "1\u0662",
    "\u0661.\u0665",
    "\uff11\uff12\uff13",
    "\U0001d7ce\U0001d7cf",
    "\u00b2",
    "\u2460",
    "\u216b",
    "\u00bd",
    "\u4e00",
    "12abc",
    "true",
]


def python_number(parse: Callable[[str], object], value: str) -> str | None:
    try:
        return repr(parse(value))
    except ValueError:
        return None


def round_inputs() -> list[float]:
    # Every multiple of 1/1024 holds the exact binary ties that round(x, 4)
    # and "%.2f" resolve to even; the seeded values look like model scores.
    rng = random.Random(20261008)
    values = [k / 1024 for k in range(-64, 1100)]
    values += [rng.random() for _ in range(500)]
    values += [0.0, -0.0, 2.675, 0.125, 0.375, 1.005, 1e-7, 0.99995, 123.45675]
    values += [1e22, 1.5e300, 5e-324, -5e-324, 0.5, 1.5, 2.5, -2.5]
    return values


def build_python_numbers_fixture() -> dict[str, object]:
    return {
        "parse": [
            {
                "input": value,
                "int": python_number(int, value),
                "float": python_number(float, value),
            }
            for value in NUMBER_INPUTS
        ],
        "intSuffixValues": code_point_map(
            lambda character: python_number(int, "1" + character)
        ),
        "round": [
            {
                "value": value,
                "round4": round(value, 4),
                "round2": round(value, 2),
                "fixed2": "%.2f" % value,
            }
            for value in round_inputs()
        ],
        "nonFinite": [
            {
                "repr": repr(value),
                "round4": repr(round(value, 4)),
                "fixed2": "%.2f" % value,
            }
            for value in [math.inf, -math.inf, math.nan]
        ],
    }


def score_width_template() -> Template:
    # The data-score-width expression of results.html, rendered by Jinja.
    source = (REPO_ROOT / "app" / "templates" / "results.html").read_text()
    match = re.search(r"\{%-\s*set score_pct = (.*?)-%\}", source, re.DOTALL)
    assert match, "results.html no longer sets score_pct"
    output = "{{ '%.2f'|format(score_pct) }}"
    assert f'data-score-width="{output}"' in source
    return templates.env.from_string(
        "{% set score_pct = " + match.group(1) + " %}" + output
    )


def build_result_score_fixture() -> dict[str, object]:
    template = score_width_template()
    scores = [None, *round_inputs(), 1.0001, 1.5, 100.0, -1.0, -0.5]
    return {
        "scoreWidths": [
            {"score": score, "width": template.render(result={"score": score})}
            for score in scores
        ],
    }


SANITIZE_INPUTS = [
    *TEXT_INPUTS,
    "  laptop computer//",
    "laptop/",
    "/",
    "a/",
    "ab ",
    "a b",
    "123 456-789.0",
    "252",
    "2525",
    "pump 2525",
    "deadbeef",
    "deadbeef1",
    "dead beef 1",
    "abcdef0123 " * 10,
    "abcd " * 10,
    "abcd1 " * 9 + "abcd1",
    "0123 4567 89ab cdef 0123 4567 89ab cdef 0123 4567",
    "ab|cd",
    "a^b",
    "a$b",
    "pipe | char",
    "\U00020000\U00020001",
    "\U0001f600\U0001f600",
    "a\U0001d400",
    "a\ufffd",
    "Caf\u00e9 \u2615",
    "1 \u00bd inch",
    "\u0661\u0662\u0663 \u0664\u0665",
    "\u00b2\u00b3 squared",
    "ab\n",
    "x" * 3999 + "/",
    "\u00e9" * 3999 + "ab",
]

CODE_LIKE_INPUTS = [
    *SHORT_TEXT_INPUTS,
    "abc1",
    "abcd1",
    "AB12C",
    "ab-12",
    "12345",
    "12.34-56",
    " 12 34 ",
    "abcde",
    "a1/b2_c3.d4-e5",
    "-a123",
    ".a123",
    "Ab12\n",
    "ab12\ncd34",
    "\u0131\u0131123",
    "\u0130\u0130123",
    "\u017f\u017f123",
    "\u212a\u212a123",
    "ab\u0661\u0662\u0663",
    "\u0661\u0662\u0663\u0664\u0665",
    "ab12\U0001f600",
]


def http_detail(call: Callable[[], str]) -> dict[str, str]:
    try:
        return {"query": call()}
    except HTTPException as exc:
        return {"detail": str(exc.detail)}


def build_query_text_fixture() -> dict[str, object]:
    return {
        "sanitize": [
            {"input": value, **http_detail(lambda: sanitize_query_text(value))}
            for value in SANITIZE_INPUTS
        ],
        "sanitizeForSearch": [
            {
                "input": value,
                **http_detail(lambda: sanitize_query_text(value, for_search=True)),
            }
            for value in SANITIZE_INPUTS
        ],
        "sanitizeAcceptedRanges": code_point_ranges(
            lambda character: "query"
            in http_detail(lambda: sanitize_query_text("a" + character + "b"))
        ),
        "searchKeptRanges": code_point_ranges(
            lambda character: sanitize_query_text(
                "a" + character + "b", for_search=True
            )
            == "a" + character + "b"
        ),
        "normalizeProductDescription": [
            {"input": value, "normalized": normalize_product_description(value)}
            for value in TEXT_INPUTS
        ],
        "isCodeLike": [
            {"input": value, "codeLike": _is_code_like(value)}
            for value in CODE_LIKE_INPUTS
        ],
        "codeLikeLetterRanges": code_point_ranges(
            lambda character: _is_code_like(character + "1234")
        ),
        "codeLikeDigitRanges": code_point_ranges(
            lambda character: _is_code_like("abcd" + character)
        ),
    }


MODEL_QUERY_INPUTS = [
    "",
    "Laptop computer",
    "  padded query  ",
    "line\nbreak",
    "\u043a\u043e\u0444\u0435 \u0432 \u0437\u0451\u0440\u043d\u0430\u0445",
    "\U0001f468\u200d\U0001f469\u200d\U0001f467 family",
]


def model_instructions() -> list[str | None]:
    configured = {
        instruction
        for config in CLASSIFIER_CONFIG.values()
        for instruction in (
            config["query_instruction"],
            config.get("rerank_instruction"),
        )
        if instruction
    }
    return [
        None,
        "",
        "  ",
        "\x1c\x85\u2028",
        "\ufeffBOM is not whitespace\ufeff",
        "\x1c Find codes \u3000",
        *sorted(configured),
    ]


RERANK_PAYLOADS = [
    {},
    {"class_name": "Pumps"},
    {"definition": "Devices that move fluids"},
    {"class_name": "Pumps", "definition": "Devices that move fluids"},
    {"class_name": "", "definition": ""},
    {"class_name": None, "definition": "Only a definition"},
    {"class_name": "Only a name", "definition": None},
    {"class_name": "\u041d\u0430\u0441\u043e\u0441\u044b", "definition": " "},
]


def build_model_text_fixture() -> dict[str, object]:
    return {
        "queryTexts": [
            {
                "query": query,
                "instruction": instruction,
                "format": query_format.value,
                "embedding": build_query_embedding_text(
                    query, instruction, query_format
                ),
                "rerank": build_rerank_query_text(query, instruction, query_format),
            }
            for query in MODEL_QUERY_INPUTS
            for instruction in model_instructions()
            for query_format in QueryFormat
        ],
        "rerankDocuments": [
            {
                "payload": payload,
                "document": _default_rerank_document({"payload": payload}),
            }
            for payload in RERANK_PAYLOADS
        ],
    }


URL_TYPES = ["UNSPSC", "HS", "CPV", "NAICS"]
# Over 200 and 4000 code points but not UTF-16 units, where slugify and
# decode_search_query truncate.
LONG_URL_INPUTS = ["\U00020000" * 150, "\U00020000" * 2500 + " tail", "x" * 4001]
FRAGMENT_PUSH_OPTIONS = [
    {"version": "", "default_version": "", "top_k": 10, "enhance_query": False},
    {
        "version": "CPV 2008 (ver. 2013)",
        "default_version": "CPV 2008 (ver. 2013)",
        "top_k": 10,
        "enhance_query": False,
    },
    {
        "version": "CPV 2008 Supplementary codes",
        "default_version": "CPV 2008 (ver. 2013)",
        "top_k": 25,
        "enhance_query": True,
    },
    {
        "version": "\u00dcn\u00efcode & spaces/slash",
        "default_version": "x",
        "top_k": 1,
        "enhance_query": False,
    },
]


def sitemap_queries() -> list[tuple[str, str]]:
    # The query of every sitemap page, plus the hyphenated spelling that must
    # still resolve to the underscore canonical.
    queries = []
    for path in sorted(SITEMAP_QUERY_PATHS):
        classifier_type, slug = path.strip("/").split("/")
        query = unquote(slug)
        queries.append((classifier_type, query.replace("_", " ")))
        if "_" in query:
            queries.append((classifier_type, query.replace("_", "-")))
    return queries


def url_cases() -> list[tuple[str, str]]:
    return [
        *sitemap_queries(),
        *(
            (classifier_type, value)
            for classifier_type in URL_TYPES
            for value in [*SHORT_TEXT_INPUTS, "!!!", "!!!/", "..", "a/b", "a__b//"]
        ),
        *(("NAICS", value) for value in LONG_URL_INPUTS),
    ]


def build_classifier_urls_fixture() -> dict[str, object]:
    cases = url_cases()
    return {
        "sitemapQueryPaths": sorted(SITEMAP_QUERY_PATHS),
        "slugify": [{"input": value, "slug": slugify(value)} for value in TEXT_INPUTS],
        "slugKeptRanges": code_point_ranges(
            lambda character: slugify("a" + character + "b") == "a" + character + "b"
        ),
        "slugSpaceRanges": code_point_ranges(
            lambda character: slugify("a" + character + "b") == "a_b"
        ),
        "decodeSearchQuery": [
            {"input": value, "decoded": decode_search_query(value)}
            for value in [*TEXT_INPUTS, "laptop_computer/", "a%2Fb", "a__b//"]
        ],
        "redirectUrls": [
            {
                "type": classifier_type,
                "searchQuery": search_query,
                "queryString": query_string,
                "url": build_classifier_redirect_url(
                    classifier_type, search_query, query_string
                ),
            }
            for classifier_type, search_query in cases
            for query_string in ["", "top_k=5&version=HS6+2022"]
            if query_string == "" or classifier_type == "HS"
        ],
        "canonicalUrls": [
            {
                "type": classifier_type,
                "decodedQuery": decoded,
                "url": canonical,
                "ssr": should_ssr(decoded, False, canonical),
                "ssrWithQueryParams": should_ssr(decoded, True, canonical),
            }
            for classifier_type, value in cases
            if (decoded := decode_search_query(value)) is not None
            if (canonical := build_classifier_canonical_url(classifier_type, decoded))
        ],
        "fragmentPushUrls": [
            {
                "type": classifier_type,
                "description": description,
                "version": options["version"],
                "defaultVersion": options["default_version"],
                "topK": options["top_k"],
                "enhanceQuery": options["enhance_query"],
                "url": build_fragment_push_url(
                    classifier_type,
                    description,
                    options["version"],
                    options["default_version"],
                    options["top_k"],
                    10,
                    enhance_query=options["enhance_query"],
                ),
            }
            for classifier_type, value in cases
            if (description := normalize_product_description(value)) is not None
            for options in FRAGMENT_PUSH_OPTIONS
            if options["version"] == ""
            or (classifier_type == "CPV" and value in SHORT_TEXT_INPUTS)
        ],
        "pageTitles": [
            {
                "type": "NAICS",
                "query": value,
                "title": build_fragment_page_title("NAICS", value),
            }
            for value in [*SHORT_TEXT_INPUTS, *TITLE_INPUTS]
        ],
    }


CLASSIFIER_TYPE_INPUTS = [
    "naics",
    "NAICS",
    " cpv ",
    "\x85HS\x85",
    "\ufeffHS",
    "gmdn",
    " GMDN",
    "\u0131sic",
    "unknown",
    "",
    "\ufb00",
    "Hts",
    "nace",
    "unspsc\u2028",
]
OPTION_INPUTS = [
    {"version": None, "top_k": None},
    {"version": "CPV 2008 Supplementary codes", "top_k": 5},
    {"version": "unknown version", "top_k": 100},
    {"version": "", "top_k": 0},
    {"version": None, "top_k": 101},
    {"version": None, "top_k": -3},
    {"version": None, "top_k": 1},
]


def resolve_type(value: str) -> dict[str, object]:
    try:
        upper_type, _ = get_classifier_or_404(value)
    except HTTPException as exc:
        return {"status": exc.status_code}
    return {"status": 200, "upperType": upper_type}


def build_classifier_options_fixture() -> dict[str, object]:
    return {
        "versions": {
            classifier_type: list(config["versions"])
            for classifier_type, config in CLASSIFIER_CONFIG.items()
        },
        "classifierTypes": [
            {"input": value, **resolve_type(value)} for value in CLASSIFIER_TYPE_INPUTS
        ],
        "options": [
            {
                "type": classifier_type,
                "version": inputs["version"],
                "topK": inputs["top_k"],
                "allowInvalidVersion": allow_invalid,
                "resolved": list(
                    resolve_classifier_options(
                        CLASSIFIER_CONFIG[classifier_type],
                        inputs["version"],
                        inputs["top_k"],
                        10,
                        allow_invalid_version=allow_invalid,
                    )
                ),
            }
            for classifier_type in ["CPV", "HS"]
            for inputs in OPTION_INPUTS
            for allow_invalid in [False, True]
        ],
    }


ORIGINAL_ID_TOKEN_INPUTS = [
    *ID_INPUTS,
    "1",
    "12",
    "123",
    "1234",
    "12345",
    "123456",
    "A1",
    "AB12345",
    "A01B234",
    "x\u00b2\u00b3\u2074",
    "\u2460\u2461\u2462\u2463",
    "\u0660\u0661\u0662\u0663\u0664",
    "\u216b12",
    "\u216b\u216b",
    "Ab\U0001f60012",
    "\U0001f60012345",
    "12\U0001f60034",
    "a\u030112",
    "\U0001d400123",
    "_12",
    "4300",
    "12.0",
]


def build_original_id_tokens_fixture() -> dict[str, object]:
    assert group_original_id_tokens(None) == []
    return {
        "tokens": [
            {
                "input": value,
                "chars": [token["char"] for token in tokens],
                "gapsAfter": [
                    index for index, token in enumerate(tokens) if token["gap_after"]
                ],
            }
            for value in ORIGINAL_ID_TOKEN_INPUTS
            if (tokens := group_original_id_tokens(value)) is not None
        ],
    }


FIXTURES: dict[str, Callable[[], dict[str, object]]] = {
    "id-lookup.json": build_id_lookup_fixture,
    "python-str.json": build_python_str_fixture,
    "python-urllib.json": build_python_urllib_fixture,
    "python-numbers.json": build_python_numbers_fixture,
    "query-text.json": build_query_text_fixture,
    "classifier-urls.json": build_classifier_urls_fixture,
    "classifier-options.json": build_classifier_options_fixture,
    "original-id-tokens.json": build_original_id_tokens_fixture,
    "result-score.json": build_result_score_fixture,
    "model-text.json": build_model_text_fixture,
}


def to_json(fixture: dict[str, object]) -> str:
    # One case per line keeps the large fixtures reviewable.
    fields = []
    for key, value in fixture.items():
        if isinstance(value, list) and value and isinstance(value[0], dict):
            cases = ",\n".join(
                "    " + json.dumps(case, ensure_ascii=False) for case in value
            )
            text = f"[\n{cases}\n  ]"
        else:
            text = json.dumps(value, ensure_ascii=False, indent=2)
            text = text.replace("\n", "\n  ")
        fields.append(f"  {json.dumps(key)}: {text}")
    return "{\n" + ",\n".join(fields) + "\n}\n"


def main() -> None:
    # Editors and agent tools may NFC-normalize non-ASCII literals, which
    # silently changes inputs such as U+212A or e + U+0301. Escape them.
    if not Path(__file__).read_bytes().isascii():
        sys.exit("Write non-ASCII inputs as escapes in export_golden_fixtures.py")
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    for name, build in FIXTURES.items():
        path = FIXTURE_DIR / name
        path.write_text(to_json(build()), encoding="utf-8")
        print(f"Wrote {path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
