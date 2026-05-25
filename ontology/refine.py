from __future__ import annotations

import argparse
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


EDGE_RE = re.compile(
    r'^(?P<prefix>\s*)"(?P<source>(?:[^"\\]|\\.)*)"\s*->\s*"(?P<target>(?:[^"\\]|\\.)*)"\s*'
    r'\[label="(?P<label>(?:[^"\\]|\\.)*)"\](?P<suffix>\s*;?\s*)$'
)


@dataclass(frozen=True)
class Edge:
    line_index: int
    source: str
    target: str
    label: str


def parse_edges(lines: list[str]) -> list[Edge]:
    # 解析 DOT 裡的 edge 行，保留原本行號，後續才能只刪除需要移除的原始行。
    edges: list[Edge] = []
    for line_index, line in enumerate(lines):
        match = EDGE_RE.match(line.rstrip("\n"))
        if not match:
            continue
        edges.append(
            Edge(
                line_index=line_index,
                source=match.group("source"),
                target=match.group("target"),
                label=match.group("label"),
            )
        )
    return edges


def build_child_map(edges: list[Edge]) -> dict[str, list[str]]:
    # 建立每個 class 的 child 清單，用來判斷某個 target 是否是 parent 底下唯一的孤支。
    children: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        children[edge.source].append(edge.target)
        children.setdefault(edge.target, [])
    return dict(children)


def collect_pruned_classes(edges: list[Edge], children: dict[str, list[str]]) -> set[str]:
    # 只刪除 sense 關係形成的孤支：target 是 source 唯一 child，且 edge label 必須是 sense。
    pruned_classes: set[str] = set()
    for edge in edges:
        is_sense_relation = edge.label == "sense"
        is_only_child = len(children.get(edge.source, [])) == 1
        if is_sense_relation and is_only_child:
            pruned_classes.add(edge.target)
    return pruned_classes


def refine_dot_text(dot_text: str) -> tuple[str, set[str], int]:
    # 依據要刪除的 class 移除相關 edge；其他 DOT 內容與排版盡量原樣保留。
    lines = dot_text.splitlines(keepends=True)
    edges = parse_edges(lines)
    children = build_child_map(edges)
    pruned_classes = collect_pruned_classes(edges, children)
    removed_line_indexes = {
        edge.line_index
        for edge in edges
        if edge.source in pruned_classes or edge.target in pruned_classes
    }
    refined_lines = [
        line for line_index, line in enumerate(lines) if line_index not in removed_line_indexes
    ]
    return "".join(refined_lines), pruned_classes, len(removed_line_indexes)


def default_output_path(input_path: Path) -> Path:
    # 預設輸出到同資料夾的新檔，避免直接覆蓋原始 ontology。
    return input_path.with_name(f"{input_path.stem}_refined{input_path.suffix}")


def parse_args() -> argparse.Namespace:
    # 提供簡單 CLI，讓之後可對 ontology_20.dot 或其他同格式 DOT 檔重複使用。
    parser = argparse.ArgumentParser(
        description=(
            "Remove singleton target classes when their incoming relation label is sense."
        )
    )
    parser.add_argument(
        "input",
        nargs="?",
        default=Path(__file__).with_name("ontology_20.dot"),
        type=Path,
        help="Input DOT file. Defaults to ontology_20.dot next to this script.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output DOT file. Defaults to <input>_refined.dot.",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Overwrite the input DOT file instead of writing a new file.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be removed without writing a file.",
    )
    return parser.parse_args()


def main() -> None:
    # 主流程：讀取 DOT、套用 refine 規則，最後輸出檔案與簡短統計。
    args = parse_args()
    input_path = args.input
    output_path = input_path if args.in_place else args.output or default_output_path(input_path)

    dot_text = input_path.read_text(encoding="utf-8-sig")
    refined_text, pruned_classes, removed_edge_count = refine_dot_text(dot_text)

    print(f"Input: {input_path}")
    print(f"Pruned classes: {len(pruned_classes)}")
    print(f"Removed edges: {removed_edge_count}")
    if pruned_classes:
        print("Classes:")
        for class_name in sorted(pruned_classes, key=str.casefold):
            print(f"- {class_name}")

    if args.dry_run:
        print("Dry run only; no file was written.")
        return

    output_path.write_text(refined_text, encoding="utf-8")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
