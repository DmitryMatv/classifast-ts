"""Export golden fixtures that pin the TypeScript ports to the Python reference.

Usage:
    python utilities/export_golden_fixtures.py

Writes one JSON file per area to test/fixtures/golden/. Rerun it after
changing a function it exports, or the Python version, and commit the
regenerated fixtures.
"""

import asyncio
import json
import logging
import math
import os
import random
import re
import sys
import tempfile
import unicodedata
from collections.abc import Callable, Iterable
from pathlib import Path
from urllib.parse import quote, quote_plus, unquote, unquote_plus, urlencode

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import dotenv
from jinja2 import Template


def ignore_developer_dotenv() -> None:
    dotenv.load_dotenv = lambda *args, **kwargs: False


ignore_developer_dotenv()

from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from app import classifier_page_delivery
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
    get_homepage_popular_lookup_links,
    get_popular_lookup_links,
    normalize_product_description,
    resolve_classifier_options,
    should_ssr,
    slugify,
)
from app.dependencies import group_original_id_tokens, templates
from app.id_lookup import normalize_original_id_for_lookup, reverse_normalized_id
from app.main import QueryNormalizationMiddleware, URLEncodingValidationMiddleware
from app.mapping_store import list_mapping_products
from app.query_enhancer import _is_code_like
from app.web import build_mapping_canonical_url

logging.disable(logging.CRITICAL)

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


def ranges_of(code_points: Iterable[int]) -> list[str]:
    ranges: list[list[int]] = []
    for code_point in code_points:
        if ranges and ranges[-1][1] == code_point - 1:
            ranges[-1][1] = code_point
        else:
            ranges.append([code_point, code_point])
    return [
        f"{start:04X}" if start == end else f"{start:04X}-{end:04X}"
        for start, end in ranges
    ]


def code_point_ranges(predicate: Callable[[str], bool]) -> list[str]:
    return ranges_of(
        code_point for code_point in CODE_POINTS if predicate(chr(code_point))
    )


def general_category_ranges() -> dict[str, list[str]]:
    by_category: dict[str, list[int]] = {}
    for code_point in CODE_POINTS:
        category = unicodedata.category(chr(code_point))
        by_category.setdefault(category, []).append(code_point)
    return {
        category: ranges_of(code_points)
        for category, code_points in sorted(by_category.items())
    }


STRIP_CHARS_INPUTS = [
    ("//a/b//", "/"),
    ("__a_b__", "_"),
    ("{{x}}", "{}"),
    ("", "/"),
    ("a", ""),
    ("\U0001f600a\U0001f600", "\U0001f600"),
    ("\U0001f601a\U0001f601", "\U0001f600"),
    ("\U0001f600\U0001f601a", "\U0001f601\U0001f600"),
    ("\u0301e\u0301", "\u0301"),
    ("\u0130i\u0131", "\u0130\u0131"),
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
        "generalCategoryRanges": general_category_ranges(),
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
            {
                "input": value,
                "stripped": value.strip(),
                "rstripped": value.rstrip(),
                "splitJoined": " ".join(value.split()),
            }
            for value in SHORT_TEXT_INPUTS
        ],
        "stripChars": [
            {
                "input": value,
                "chars": chars,
                "stripped": value.strip(chars),
                "rstripped": value.rstrip(chars),
            }
            for value, chars in STRIP_CHARS_INPUTS
        ],
        "codePoints": [
            {"input": value, "length": len(value), "firstThree": value[:3]}
            for value in SHORT_TEXT_INPUTS
        ],
    }


QUOTE_SAFE_SETS = ["", "/", "()*,:"]
LONE_SURROGATE_INPUTS = [
    "\ud800",
    "a\udfffb",
    "\udc00\ud800",
    "\ud83d\U0001f600",
    "%41\ud800%42",
]
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
    *LONE_SURROGATE_INPUTS,
]

URLENCODE_INPUTS = [
    [],
    [["version", "CPV 2008 (ver. 2013)"]],
    [["version", "HS6 2022"], ["top_k", "25"], ["enhance_query", "1"]],
    [["q", "a&b=c+d/\u00e9\U0001f600"], ["empty", ""]],
    [["key with space", "~*'()!"]],
    [["q", "\ud800"]],
]


def unless_unicode_encode_error(call: Callable[[], str]) -> str | None:
    try:
        return call()
    except UnicodeEncodeError:
        return None


def build_python_urllib_fixture() -> dict[str, object]:
    quote_inputs = [
        *SHORT_TEXT_INPUTS,
        *(chr(code_point) for code_point in range(128)),
        *LONE_SURROGATE_INPUTS,
    ]
    return {
        "quote": [
            {
                "input": value,
                "safe": safe,
                "quoted": unless_unicode_encode_error(lambda: quote(value, safe=safe)),
            }
            for safe in QUOTE_SAFE_SETS
            for value in quote_inputs
        ],
        "quotePlus": [
            {
                "input": value,
                "quoted": unless_unicode_encode_error(
                    lambda: quote_plus(value, safe="")
                ),
            }
            for value in quote_inputs
        ],
        "unquote": {
            value: unquote(value)
            for value in [*UNQUOTE_INPUTS, *percent_sweep_inputs()]
        },
        "unquotePlus": {value: unquote_plus(value) for value in UNQUOTE_INPUTS},
        "urlencode": [
            {
                "pairs": pairs,
                "encoded": unless_unicode_encode_error(
                    lambda: urlencode([tuple(pair) for pair in pairs])
                ),
            }
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
    "1" + " " * 64 + "x",
    "1" * 64 + "x",
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
    rng = random.Random(20261008)
    exact_binary_ties = [k / 1024 for k in range(-64, 1100)]
    values = exact_binary_ties + [rng.random() for _ in range(500)]
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


SCORE_WIDTH = "{{ '%.2f'|format(score_pct) }}"
SCORE_LABEL = '{{ "%.1f"|format(score_pct) }}'


def score_template() -> Template:
    source = (REPO_ROOT / "app" / "templates" / "results.html").read_text()
    match = re.search(r"\{%-\s*set score_pct = (.*?)-%\}", source, re.DOTALL)
    assert match, "results.html no longer sets score_pct"
    assert f'data-score-width="{SCORE_WIDTH}"' in source
    assert f"{SCORE_LABEL}%" in source
    set_score = "{% set score_pct = " + match.group(1) + " %}"
    return templates.env.from_string(f"{set_score}{SCORE_WIDTH} {SCORE_LABEL}")


def build_result_score_fixture() -> dict[str, object]:
    template = score_template()
    scores = [None, *round_inputs(), 1.0001, 1.5, 100.0, -1.0, -0.5]
    cases = []
    for score in scores:
        width, label = template.render(result={"score": score}).split(" ")
        cases.append({"score": score, "width": width, "label": label})
    return {"scores": cases}


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
CODE_POINT_LIMIT_INPUTS = [
    "\U00020000" * 150,
    "\U00020000" * 2500 + " tail",
    "x" * 4001,
]
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
        *(("NAICS", value) for value in CODE_POINT_LIMIT_INPUTS),
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


SYNTHETIC_SITEMAP = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url><loc>https://classifast.com/</loc></url>
  <url><loc>https://classifast.com/HS/</loc></url>
  <url><loc>https://classifast.com/HS/laptop_computer/</loc></url>
  <url><loc>https://classifast.com/HS/no_trailing_slash</loc></url>
  <url><loc>https://classifast.com/hs/lowercase_type/</loc></url>
  <url><loc>https://classifast.com/GMDN/removed_type/</loc></url>
  <url><loc>https://classifast.com/NAICS/a/b/</loc></url>
  <url><loc>https://classifast.com//NAICS//double_slashes//</loc></url>
  <url><loc>https://classifast.com/CPV/with_query/?top_k=5</loc></url>
  <url><loc>https://classifast.com/CPV/with_fragment/#results</loc></url>
  <url><loc>https://classifast.com/CPV/semi;colon/x;params</loc></url>
  <url><loc>https://classifast.com/CPV/semi;colon</loc></url>
  <url><loc>https://classifast.com/NSN/caf%C3%A9/</loc></url>
  <url><loc>https://classifast.com/NSN/fish_&amp;_chips/</loc></url>
  <url><loc>https://classifast.com/NSN/&#x63;ode&#46;/</loc></url>
  <url><loc>/ETIM/relative_url/</loc></url>
  <url><loc>https://blog.classifast.com/ETIM/other_host/</loc></url>
  <url><loc></loc></url>
  <!-- <url><loc>https://classifast.com/HS/commented_out/</loc></url> -->
  <url>
    <loc>https://classifast.com/UNSPSC/with_image/</loc>
    <image:image><image:loc>https://classifast.com/ISIC/image_loc/</image:loc></image:image>
  </url>
</urlset>
"""


def load_sitemap_query_paths(xml: str) -> list[str]:
    original_base_dir = classifier_page_delivery.BASE_DIR
    with tempfile.TemporaryDirectory() as directory:
        static_dir = Path(directory) / "app" / "static"
        static_dir.mkdir(parents=True)
        (static_dir / "sitemap.xml").write_text(xml, encoding="utf-8")
        classifier_page_delivery.BASE_DIR = Path(directory)
        try:
            return sorted(classifier_page_delivery._load_sitemap_query_paths())
        finally:
            classifier_page_delivery.BASE_DIR = original_base_dir


def build_sitemap_fixture() -> dict[str, object]:
    return {
        "queryPaths": sorted(SITEMAP_QUERY_PATHS),
        "syntheticXml": SYNTHETIC_SITEMAP,
        "syntheticQueryPaths": load_sitemap_query_paths(SYNTHETIC_SITEMAP),
    }


POPULAR_LOOKUP_TYPE_INPUTS = [
    *CLASSIFIER_CONFIG,
    "unspsc",
    " hs\n",
    "\x85NAICS",
    "UNKNOWN",
    "",
]


def popular_lookups(sitemap_paths: frozenset[str]) -> dict[str, object]:
    original_paths = classifier_page_delivery.SITEMAP_QUERY_PATHS
    classifier_page_delivery.SITEMAP_QUERY_PATHS = sitemap_paths
    try:
        return {
            "sitemapQueryPaths": sorted(sitemap_paths),
            "byType": [
                {
                    "input": value,
                    "links": get_popular_lookup_links(value),
                }
                for value in POPULAR_LOOKUP_TYPE_INPUTS
            ],
            "homepage": get_homepage_popular_lookup_links(),
        }
    finally:
        classifier_page_delivery.SITEMAP_QUERY_PATHS = original_paths


def build_popular_lookups_fixture() -> dict[str, object]:
    sparse_paths = frozenset(sorted(SITEMAP_QUERY_PATHS)[::2])
    return {
        "sitemaps": [
            popular_lookups(SITEMAP_QUERY_PATHS),
            popular_lookups(sparse_paths),
        ],
    }


MAPPING_SLUG_INPUTS = [
    None,
    "",
    *(product.slug for product in list_mapping_products()),
    "a/b",
    "caf\u00e9 au lait",
    "trailing/",
    "%41",
]


def build_mapping_urls_fixture() -> dict[str, object]:
    return {
        "canonicalUrls": [
            {"slug": slug, "url": build_mapping_canonical_url(slug)}
            for slug in MAPPING_SLUG_INPUTS
        ],
    }


LATIN1_QUERY_INPUTS = [
    "",
    "a=1",
    "q=laptop",
    "q=%20laptop%20",
    "q=+laptop+",
    "q=a++b",
    "q=a%09b",
    "q=a%C2%A0b",
    "q=a%E2%80%8Bb",
    "q=a%1Cb",
    "q=a%C2%85b",
    "q=%85x%20",
    "q=%EF%BB%BFx",
    "q=x%EF%BB%BF",
    "q=%E3%80%80x",
    "&&a=%201&&",
    "=%20x",
    "x=",
    "x",
    "%20x",
    "a=1=%202",
    "a=%20&a=%20b",
    "k%20ey=%20v",
    "q=(a),b*c:d%20",
    "q=a/b?c%20",
    "q=caf%C3%A9%20",
    "q=\xe9%20",
    "q=\xc3\xa9%20",
    "version=CPV+2008+(ver.+2013)&top_k=5",
    "version=CPV%202008%20%20(ver.%202013)&top_k=5",
    "q=%2B%20",
    "q=%",
    "q=%zz%20",
    "q=%25%20",
    "top_k=10&q=%E5%95%86%E5%93%81%20",
    "q=%F0%9F%98%80%20",
    "q=%E2%80%A8x",
    "a=%20;b=1",
]

SUSPICIOUS_URL_INPUTS = [
    ("/", ""),
    ("/HS/laptop_computer/", "top_k=12"),
    ("/HS/" + "12" * 20 + "/", ""),
    ("/HS/" + "1234" * 16 + "/", ""),
    ("/HS/" + "1" * 49 + "/", ""),
    ("/HS/" + "1" * 50 + "/", ""),
    ("/HS/" + "\u0661" * 50 + "/", ""),
    ("/HS/" + "\uff11" * 50 + "/", ""),
    ("/HS/" + "\u00b9" * 50 + "/", ""),
    ("/HS/", "q=" + "%31" * 50),
    ("/HS/", "q=" + "%31" * 50 + "&q=x"),
    ("/HS/", "q=x&q=" + "%31" * 50),
    ("/HS/", "a=" + "1" * 25 + "&b=" + "1" * 25),
    ("/HS/", "q=%25%25%25"),
    ("/HS/", "q=%2525%2525%2525"),
    ("/HS/%25%25", ""),
    ("/HS/", "q=%3c%3c"),
    ("/HS/", "q=%3C%3C"),
    ("/HS/", "q=%3e%3e"),
    ("/HS/<<", ""),
    ("/HS/" + "a" * 64 + "/", ""),
    ("/HS/" + "a" * 63 + "/", ""),
    ("/HS/g" + "a" * 64 + "/", ""),
    ("/HS/_" + "a" * 64 + "_/", ""),
    ("/HS/\u00e9" + "a" * 64 + "/", ""),
    ("/HS/", "x=cfRLUnblockHandlers"),
    ("/HS/", "x=UnblockHandler"),
    ("/HS/", "copyOriginalId"),
    ("/HS/", "x=copy%4FriginalId"),
    ("/HS/" + "x" * 3990, "q=123456"),
    ("/HS/" + "x" * 3990, "q=1234"),
    ("/HS/" + "\U0001f600" * 2100, ""),
    ("/HS/" + "\U0001f600" * 4000, ""),
]


def starlette_request(path: str, query: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "query_string": query.encode("latin-1"),
            "headers": [(b"host", b"classifast.com")],
            "scheme": "https",
            "server": ("classifast.com", 443),
            "root_path": "",
        }
    )


async def passed_through(_request: Request) -> Response:
    return Response("passed")


def canonical_query(query: str) -> dict[str, str | None]:
    middleware = QueryNormalizationMiddleware(app=None)
    try:
        response = asyncio.run(
            middleware.dispatch(starlette_request("/HS/", query), passed_through)
        )
    except UnicodeDecodeError:
        return {"pythonError": "UnicodeDecodeError"}
    if response.status_code != 308:
        return {"canonicalQuery": None}
    return {"canonicalQuery": response.headers["location"].split("?", 1)[1]}


def is_suspicious(path: str, query: str) -> bool:
    middleware = URLEncodingValidationMiddleware(app=None)
    response = asyncio.run(
        middleware.dispatch(starlette_request(path, query), passed_through)
    )
    return response.status_code == 400


def build_request_url_fixture() -> dict[str, object]:
    return {
        "queries": [
            {
                "query": query,
                "items": starlette_request("/", query).query_params.multi_items(),
                **canonical_query(query),
            }
            for query in LATIN1_QUERY_INPUTS
        ],
        "suspicious": [
            {"path": path, "query": query, "suspicious": is_suspicious(path, query)}
            for path, query in SUSPICIOUS_URL_INPUTS
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
    None,
    True,
    False,
    0,
    12,
    4300,
    -4300,
    9007199254740991,
    -9007199254740991,
    12.5,
    -12.5,
    0.125,
    -0.125,
    0.0001,
    -0.0001,
    4300.25,
]


def original_id_token_output(value: object) -> dict[str, object]:
    tokens = group_original_id_tokens(value)
    return {
        "chars": [token["char"] for token in tokens],
        "gapsAfter": [
            index for index, token in enumerate(tokens) if token["gap_after"]
        ],
    }


def build_original_id_tokens_fixture() -> dict[str, object]:
    return {
        "tokens": [
            {
                "input": value,
                **original_id_token_output(value),
            }
            for value in ORIGINAL_ID_TOKEN_INPUTS
        ],
        "sourceLoss": [
            {
                "inputJson": input_json,
                "source": original_id_token_output(json.loads(input_json)),
                "parsedInteger": original_id_token_output(int(json.loads(input_json))),
            }
            for input_json in ["12", "12.0", "0", "0.0"]
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
    "sitemap.json": build_sitemap_fixture,
    "popular-lookups.json": build_popular_lookups_fixture,
    "mapping-urls.json": build_mapping_urls_fixture,
    "request-url.json": build_request_url_fixture,
}


SURROGATE = re.compile("[\ud800-\udfff]")
HIGH_THEN_LOW_SURROGATE = re.compile("[\ud800-\udbff][\udc00-\udfff]")


def escape_lone_surrogates(text: str) -> str:
    # JSON.parse joins an escaped high and low surrogate into one character,
    # where Python had two.
    assert not HIGH_THEN_LOW_SURROGATE.search(text), "surrogate pair in a fixture"
    return SURROGATE.sub(lambda match: f"\\u{ord(match.group()):04x}", text)


def to_json(fixture: dict[str, object]) -> str:
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
    return escape_lone_surrogates("{\n" + ",\n".join(fields) + "\n}\n")


def main() -> None:
    if not Path(__file__).read_bytes().isascii():
        sys.exit(
            "Write non-ASCII inputs as escapes in export_golden_fixtures.py;"
            " editors can NFC-normalize literal inputs such as e + U+0301"
        )
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    for name, build in FIXTURES.items():
        path = FIXTURE_DIR / name
        path.write_text(to_json(build()), encoding="utf-8")
        print(f"Wrote {path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
