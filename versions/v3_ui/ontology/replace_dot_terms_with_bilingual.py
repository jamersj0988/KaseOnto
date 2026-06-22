from __future__ import annotations

import argparse
import re
from pathlib import Path


# 中文註解：這個正則專門抓 DOT 內雙引號包住的字串，用來逐一替換節點名稱。
QUOTED_TEXT_PATTERN = re.compile(r'"([^"]*)"')

# 中文註解：這個正則解析 txt 每一行的 `英文(中文)` 格式，英文部分當成查找 key，整行當成替換值。
MAPPING_LINE_PATTERN = re.compile(r"^(?P<english>.+?)\((?P<chinese>.+)\)$")


def load_term_mapping(mapping_path: Path) -> dict[str, str]:
    # 中文註解：明確用 UTF-8 讀取對照檔，避免 shell 或系統預設編碼把中文弄壞。
    lines = mapping_path.read_text(encoding="utf-8").splitlines()
    mapping: dict[str, str] = {}

    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line:
            continue

        match = MAPPING_LINE_PATTERN.match(line)
        if not match:
            raise ValueError(
                f"Invalid mapping format at line {line_number}: {raw_line!r}. "
                "Expected format like English(中文)."
            )

        english = match.group("english").strip()
        mapping[english] = line

    return mapping


def replace_terms_in_dot(dot_text: str, mapping: dict[str, str]) -> tuple[str, set[str]]:
    missing_terms: set[str] = set()
    updated_lines: list[str] = []

    for line in dot_text.splitlines():
        # 中文註解：只有 relation 行才需要替換，其他像 digraph 標題或空白行原樣保留。
        if "->" not in line:
            updated_lines.append(line)
            continue

        quoted_matches = list(QUOTED_TEXT_PATTERN.finditer(line))
        if not quoted_matches:
            updated_lines.append(line)
            continue

        # 中文註解：有 `[label="..."]` 的行，最後一個雙引號字串就是 label 值，不能替換。
        replace_count = len(quoted_matches) - 1 if "[label=" in line else len(quoted_matches)
        rebuilt_parts: list[str] = []
        last_index = 0

        for match_index, match in enumerate(quoted_matches):
            rebuilt_parts.append(line[last_index:match.start()])
            term = match.group(1)

            if match_index < replace_count:
                replacement = mapping.get(term)
                if replacement is None:
                    missing_terms.add(term)
                    rebuilt_parts.append(match.group(0))
                else:
                    rebuilt_parts.append(f'"{replacement}"')
            else:
                rebuilt_parts.append(match.group(0))

            last_index = match.end()

        rebuilt_parts.append(line[last_index:])
        updated_lines.append("".join(rebuilt_parts))

    updated_text = "\n".join(updated_lines)
    if dot_text.endswith("\n"):
        updated_text += "\n"

    return updated_text, missing_terms


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Replace quoted DOT terms with bilingual English(Chinese) versions from a txt mapping file."
    )
    parser.add_argument(
        "dot_file",
        nargs="?",
        default=Path(__file__).with_name("ontology_20.dot"),
        type=Path,
        help="Path to the input DOT file.",
    )
    parser.add_argument(
        "--mapping-txt",
        default=Path(__file__).with_name("ontology_terms.txt"),
        type=Path,
        help="Path to the txt mapping file that stores lines like English(中文).",
    )
    parser.add_argument(
        "--output-dot",
        default=Path(__file__).with_name("ontology_20_bilingual.dot"),
        type=Path,
        help="Path to the output DOT file.",
    )
    args = parser.parse_args()

    mapping = load_term_mapping(args.mapping_txt)
    # 中文註解：DOT 也固定用 UTF-8 讀寫，確保替換後的中文能正確留在輸出檔。
    dot_text = args.dot_file.read_text(encoding="utf-8")
    updated_text, missing_terms = replace_terms_in_dot(dot_text, mapping)
    args.output_dot.write_text(updated_text, encoding="utf-8")

    print(f"Wrote bilingual DOT to: {args.output_dot}")
    print(f"Loaded mappings: {len(mapping)}")
    print(f"Unmapped quoted terms kept as-is: {len(missing_terms)}")

    if missing_terms:
        print("Missing terms:")
        for term in sorted(missing_terms, key=str.casefold):
            print(term)


if __name__ == "__main__":
    main()
