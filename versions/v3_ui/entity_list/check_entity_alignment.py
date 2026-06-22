from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path


DASH_PATTERN = re.compile(r"[\u2010-\u2015\u2212]")


def parse_entity_lines(text: str) -> list[str]:
    # 將 entity 檔整理成「每行一個 entity」，並忽略空白行，對齊 app.js 的載入方式。
    return [line.strip() for line in text.splitlines() if line.strip()]


def parse_translation_label(label: str) -> dict[str, str]:
    # 解析中文 entity 的「中文(English)」格式，括號內英文會作為中英文配對主鍵。
    trimmed = str(label or "").strip()
    depth = 0
    bracket_start = -1

    # 從結尾反向找最後一組完整括號，避免中文 label 內的「（補充說明）」被誤當成英文 key。
    for index in range(len(trimmed) - 1, -1, -1):
        character = trimmed[index]

        if character in "）)":
            depth += 1
        elif character in "（(":
            depth -= 1

            if depth == 0:
                bracket_start = index
                break

    if bracket_start == -1 or depth != 0:
        return {
            "display_label": trimmed,
            "original_label": "",
        }

    return {
        "display_label": trimmed,
        "original_label": trimmed[bracket_start + 1 : -1].strip(),
    }


def normalize_pairing_key(label: str) -> str:
    # 對配對用 key 做最小必要正規化：統一 dash、連續空白與大小寫。
    return DASH_PATTERN.sub("-", str(label or "")).strip().lower()


def compact_pairing_key(label: str) -> str:
    # 先統一 dash，再把任意連續空白壓成單一空白，避免換行或多空格造成誤判。
    return re.sub(r"\s+", " ", normalize_pairing_key(label))


def resolve_case_path(cases_json_path: Path, relative_path: str) -> Path:
    # cases.json 內的資料路徑都相對於 cases.json 所在資料夾。
    return (cases_json_path.parent / relative_path).resolve()


def fill_case_template_value(value: str | None, case_number: int | str) -> str | None:
    # cases.json 的 template 欄位可用 {case} 當數字變數，檢查前需先展開。
    if isinstance(value, str):
        return value.replace("{case}", str(case_number))

    return value


def build_case_option_from_template(template: dict, case_number: int | str) -> dict:
    # 將簡短 caseNumbers/template 格式轉成完整 case option，與 app.js 的載入結構一致。
    languages = template.get("languages", {})
    original = languages.get("original", {})
    translation = languages.get("translation", {})

    return {
        "id": fill_case_template_value(template.get("id", "case{case}"), case_number),
        "label": fill_case_template_value(template.get("label", "Case {case}"), case_number),
        "languages": {
            "original": {
                "corpus": fill_case_template_value(original.get("corpus"), case_number),
                "entities": fill_case_template_value(original.get("entities"), case_number),
            },
            "translation": {
                "corpus": fill_case_template_value(translation.get("corpus"), case_number),
                "entities": fill_case_template_value(translation.get("entities"), case_number),
            },
        },
    }


def expand_cases_config(cases_config: list | dict) -> list[dict]:
    # 保留舊 array 格式，也支援新的 caseNumbers/template 簡寫格式。
    if isinstance(cases_config, list):
        return cases_config

    case_numbers = cases_config.get("caseNumbers", []) if isinstance(cases_config, dict) else []
    template = cases_config.get("template", {}) if isinstance(cases_config, dict) else {}

    return [build_case_option_from_template(template, case_number) for case_number in case_numbers]


def inspect_case(case_item: dict, cases_json_path: Path) -> dict:
    # 對單一 case 執行和 v3_ui 相同的括號英文配對檢查，並收集可能需要人工處理的問題。
    original_path = resolve_case_path(cases_json_path, case_item["languages"]["original"]["entities"])
    translation_path = resolve_case_path(cases_json_path, case_item["languages"]["translation"]["entities"])
    original_lines = parse_entity_lines(original_path.read_text(encoding="utf-8"))
    translation_lines = parse_entity_lines(translation_path.read_text(encoding="utf-8"))
    original_keys = [compact_pairing_key(line) for line in original_lines]
    original_key_counts = Counter(original_keys)
    translations_by_key = defaultdict(list)
    bracketless_translations = []

    for index, line in enumerate(translation_lines, start=1):
        parsed = parse_translation_label(line)
        pairing_key = compact_pairing_key(parsed["original_label"])

        if pairing_key:
            translations_by_key[pairing_key].append(
                {
                    "line": index,
                    "display_label": parsed["display_label"],
                    "original_label": parsed["original_label"],
                }
            )
        else:
            bracketless_translations.append(
                {
                    "line": index,
                    "display_label": parsed["display_label"],
                }
            )

    unmatched_translations = []
    duplicate_translation_keys = []

    for pairing_key, entries in translations_by_key.items():
        if pairing_key not in original_key_counts:
            unmatched_translations.extend(entries)

        if len(entries) > original_key_counts.get(pairing_key, 0):
            duplicate_translation_keys.append(
                {
                    "key": pairing_key,
                    "original_count": original_key_counts.get(pairing_key, 0),
                    "translation_count": len(entries),
                    "lines": [entry["line"] for entry in entries],
                }
            )

    translation_key_counts = Counter(translations_by_key.keys())
    unmatched_originals = []

    for index, line in enumerate(original_lines, start=1):
        pairing_key = original_keys[index - 1]
        if translation_key_counts.get(pairing_key, 0) < original_key_counts[pairing_key]:
            matched_same_line = index <= len(translation_lines) and not parse_translation_label(translation_lines[index - 1])[
                "original_label"
            ]

            if not matched_same_line and translation_key_counts.get(pairing_key, 0) == 0:
                unmatched_originals.append(
                    {
                        "line": index,
                        "original_label": line,
                    }
                )

    return {
        "id": case_item.get("id", ""),
        "label": case_item.get("label", case_item.get("id", "")),
        "original_path": str(original_path),
        "translation_path": str(translation_path),
        "original_count": len(original_lines),
        "translation_count": len(translation_lines),
        "bracketed_translation_count": len(translation_lines) - len(bracketless_translations),
        "bracketless_translations": bracketless_translations,
        "unmatched_translations": unmatched_translations,
        "unmatched_originals": unmatched_originals,
        "duplicate_translation_keys": duplicate_translation_keys,
    }


def print_case_report(result: dict) -> bool:
    # 輸出人可讀的檢查報告；回傳 True 表示此 case 沒有阻擋性問題。
    has_blocking_issues = bool(result["unmatched_translations"] or result["duplicate_translation_keys"])
    status = "OK" if not has_blocking_issues else "CHECK"

    print(f"[{status}] {result['label']} ({result['id']})")
    print(
        "  counts: "
        f"original={result['original_count']}, "
        f"translation={result['translation_count']}, "
        f"bracketed_translation={result['bracketed_translation_count']}"
    )

    if result["bracketless_translations"]:
        print("  bracketless translations, will use same-line fallback in app.js:")
        for item in result["bracketless_translations"]:
            print(f"    line {item['line']}: {item['display_label']}")

    if result["unmatched_translations"]:
        print("  unmatched translations, bracket English not found in original entity list:")
        for item in result["unmatched_translations"]:
            print(f"    line {item['line']}: {item['display_label']} -> {item['original_label']}")

    if result["unmatched_originals"]:
        print("  original entities without bracket-key translation:")
        for item in result["unmatched_originals"]:
            print(f"    line {item['line']}: {item['original_label']}")

    if result["duplicate_translation_keys"]:
        print("  duplicate or overused translation keys:")
        for item in result["duplicate_translation_keys"]:
            lines = ", ".join(str(line) for line in item["lines"])
            print(
                f"    key={item['key']} original_count={item['original_count']} "
                f"translation_count={item['translation_count']} lines={lines}"
            )

    return not has_blocking_issues


def main() -> int:
    # 入口點：預設讀取 ../data/cases.json，也可用參數指定其他 cases.json。
    script_dir = Path(__file__).resolve().parent
    default_cases_json = (script_dir.parent / "data" / "cases.json").resolve()
    parser = argparse.ArgumentParser(description="Check bilingual entity list alignment for v3_ui.")
    parser.add_argument(
        "--cases-json",
        type=Path,
        default=default_cases_json,
        help="Path to v3_ui/data/cases.json. Defaults to ../data/cases.json.",
    )
    args = parser.parse_args()
    cases_json_path = args.cases_json.resolve()

    cases = expand_cases_config(json.loads(cases_json_path.read_text(encoding="utf-8")))
    all_ok = True

    for case_item in cases:
        result = inspect_case(case_item, cases_json_path)
        all_ok = print_case_report(result) and all_ok

    return 0 if all_ok else 1


if __name__ == "__main__":
    # 讓命令列可以用 exit code 判斷檢查是否通過，方便之後接進固定工作流程。
    sys.exit(main())
