from __future__ import annotations

import argparse
import re
from pathlib import Path


# 中文註解：這個正則會抓出 DOT 行內所有被雙引號包住的字串，例如 source、target、label 值。
QUOTED_TEXT_PATTERN = re.compile(r'"([^"]*)"')


def extract_non_label_terms(dot_text: str) -> set[str]:
    # 中文註解：用 set 去重，最後留下 ontology 節點名稱等唯一字串。
    terms: set[str] = set()

    for line in dot_text.splitlines():
        # 中文註解：只處理有箭頭的 relation 行，避免把 digraph 名稱或其他註解一起抓進來。
        if "->" not in line:
            continue

        quoted_parts = QUOTED_TEXT_PATTERN.findall(line)
        if not quoted_parts:
            continue

        # 中文註解：DOT 格式中最後一個雙引號字串通常是 label 值，所以只保留前面的 source / target。
        if "[label=" in line and len(quoted_parts) >= 2:
            terms.update(quoted_parts[:-1])
        else:
            terms.update(quoted_parts)

    return terms


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract all quoted strings except label values from a DOT file."
    )
    parser.add_argument(
        "dot_file",
        nargs="?",
        default=Path(__file__).with_name("ontology_20.dot"),
        type=Path,
        help="Path to the DOT file. Defaults to ontology_20.dot in the same folder.",
    )
    parser.add_argument(
        "--as-python-set",
        action="store_true",
        help="Print the result as a Python set literal.",
    )
    parser.add_argument(
        "--output-txt",
        nargs="?",
        const=Path(__file__).with_name("ontology_terms_en.txt"),
        type=Path,
        help="Write the extracted terms to a txt file. Defaults to ontology_terms.txt in the same folder.",
    )
    args = parser.parse_args()

    # 中文註解：明確指定 UTF-8 讀檔，避免 Windows shell 編碼介入。
    dot_text = args.dot_file.read_text(encoding="utf-8")
    terms = extract_non_label_terms(dot_text)

    if args.output_txt:
        # 中文註解：輸出成純文字檔時，每行一筆 term，方便後續人工檢查或再給其他程式使用。
        args.output_txt.write_text(
            "\n".join(sorted(terms, key=str.casefold)),
            encoding="utf-8",
        )
        print(f"Wrote {len(terms)} terms to: {args.output_txt}")
        return

    if args.as_python_set:
        print(set(sorted(terms)))
        return

    print(f"Total unique non-label strings: {len(terms)}")
    for term in sorted(terms, key=str.casefold):
        print(term)


if __name__ == "__main__":
    main()
