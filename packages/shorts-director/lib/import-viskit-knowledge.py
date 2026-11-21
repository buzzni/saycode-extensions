#!/usr/bin/env python3
"""viskit(shorts_maker) 총감독 지식 원문을 이 프로젝트의 knowledge/ 로 가져온다.

원문은 비공개 저장소의 자산이라 이 패키지(공개 npm)에 싣지 않는다. shorts_maker 에 접근할 수 있는 사람이
자기 PC 에서 이 스크립트를 실행해 로컬로만 가져온다. knowledge/ 는 .gitignore 에 들어 있다 — 커밋·공유하지 않는다.

    npx @buzzni/shorts-director import-knowledge --from /path/to/shorts_maker

파이썬 표준 라이브러리만 쓴다. 원문 파이썬 파일은 실행하지 않고 구문 트리에서 문자열 상수만 읽는다.
"""

from __future__ import annotations

import argparse
import ast
import datetime
import json
import shutil
import subprocess
import sys
from pathlib import Path

FS = Path("apps/viskit/backend/pipeline/workflow/freeform_short")
CAPABILITIES = Path("apps/viskit/backend/pipeline/schemas/freeform_short_capabilities.py")

# (출력 파일, 원문 파일, 꺼낼 이름들, 설명). 이름이 "dict:<key>" 면 모듈 수준 dict 의 그 키에 든 SkillSpec 호출에서
# 문자열 키워드 인자(plan/text/production 등)를 꺼낸다. "call:<NAME>" 은 NAME = Something(...) 호출의 문자열 인자다.
SOURCES = [
    ("planning.md", FS / "prompts.py", ["_AGENT_SYSTEM"], "기획 원칙 — 총감독 기획 시스템 프롬프트"),
    ("production.md", FS / "prompts.py", ["_PRODUCTION_SYSTEM", "_PRODUCTION_CRITIQUE_SYSTEM"], "제작 결정 원칙과 자기 검토"),
    ("text-design.md", FS / "prompts.py", ["DESIGN_PRINCIPLES", "_TEXT_DESIGN_SYSTEM"], "화면 문구·자막 디자인"),
    ("hook.md", FS / "skills/techniques.py", ["dict:hook"], "훅 기법"),
    ("techniques.md", FS / "skills/techniques.py",
     ["dict:phone_ugc", "dict:logo_shot", "dict:app_demo", "dict:motion_graphics", "dict:tiny_character", "dict:cutout_sticker"],
     "연출 기법"),
    ("viewer-check.md", FS / "viewer_check.py", ["_TRANSCRIBE", "_RETELL"], "시청자 점검 2단계 프롬프트"),
    ("video-guides.md", FS / "video_guides.py", ["call:OMNI"], "Omni 영상 프롬프트 문법(API 기준)"),
    ("capability-guides.md", CAPABILITIES, ["*_GUIDE"], "말·자막·문구·음악·테이크 가이드"),
]
DIRECTORIES = [
    ("genres", FS / "skills/genres"),
    ("industries", FS / "skills/industries"),
    ("legal", FS / "legal_reference"),
]


CONTENT_FIELDS = {"plan", "text", "production"}


class Unresolved(Exception):
    pass


def evaluate(node: ast.AST, names: dict[str, ast.AST], depth: int = 0) -> str:
    """문자열 식을 실행하지 않고 펼친다. 모르는 이름은 {이름} 자리표시로 남긴다."""
    if depth > 20:
        raise Unresolved("too deep")
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts = []
        for value in node.values:
            if isinstance(value, ast.Constant):
                parts.append(str(value.value))
            elif isinstance(value, ast.FormattedValue):
                target = names.get(value.value.id) if isinstance(value.value, ast.Name) else value.value
                if isinstance(target, ast.Constant) and isinstance(target.value, (int, float)):
                    parts.append(str(target.value))
                    continue
                try:
                    parts.append(evaluate(value.value, names, depth + 1))
                except Unresolved:
                    parts.append("{" + ast.unparse(value.value) + "}")
        return "".join(parts)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return evaluate(node.left, names, depth + 1) + evaluate(node.right, names, depth + 1)
    if isinstance(node, ast.Name) and node.id in names:
        return evaluate(names[node.id], names, depth + 1)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ("strip", "lstrip", "rstrip") and not node.args:
        return getattr(evaluate(node.func.value, names, depth + 1), node.func.attr)()
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "replace" and len(node.args) == 2:
        base = evaluate(node.func.value, names, depth + 1)
        old = evaluate(node.args[0], names, depth + 1)
        try:
            return base.replace(old, evaluate(node.args[1], names, depth + 1))
        except Unresolved:
            return base  # 런타임에만 정해지는 값(카탈로그 등)은 자리표시로 둔다
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "join" and len(node.args) == 1:
        separator = evaluate(node.func.value, names, depth + 1)
        if isinstance(node.args[0], (ast.List, ast.Tuple)):
            return separator.join(evaluate(item, names, depth + 1) for item in node.args[0].elts)
    raise Unresolved(ast.unparse(node)[:80])


def module_names(tree: ast.Module) -> dict[str, ast.AST]:
    names: dict[str, ast.AST] = {}
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name):
            names[statement.targets[0].id] = statement.value
        elif isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name) and statement.value is not None:
            names[statement.target.id] = statement.value
    return names


def string_keywords(call: ast.Call, names: dict[str, ast.AST]) -> list[tuple[str, str]]:
    out = []
    for keyword in call.keywords:
        if keyword.arg is None:
            continue
        try:
            text = evaluate(keyword.value, names)
        except Unresolved:
            continue
        # 본문 필드는 이름으로, 그 밖의 필드는 길이로 고른다(key·label 같은 짧은 메타는 버린다).
        if keyword.arg in CONTENT_FIELDS or len(text) > 80:
            out.append((keyword.arg, text))
    return out


def dict_entry(names: dict[str, ast.AST], key: str) -> ast.Call | None:
    for value in names.values():
        if isinstance(value, ast.Dict):
            for k, v in zip(value.keys, value.values):
                if isinstance(k, ast.Constant) and k.value == key and isinstance(v, ast.Call):
                    return v
    return None


def extract(path: Path, selectors: list[str]) -> tuple[list[tuple[str, str]], list[str]]:
    """선택자마다 따로 꺼낸다 — 원문에서 이름 하나가 바뀌어도 나머지는 가져오고, 빠진 것은 보고한다."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = module_names(tree)
    sections: list[tuple[str, str]] = []
    missing: list[str] = []
    for selector in selectors:
        try:
            sections += extract_one(names, selector)
        except Unresolved as error:
            missing.append(f"{selector} ({error})")
    return sections, missing


def extract_one(names: dict[str, ast.AST], selector: str) -> list[tuple[str, str]]:
    if selector.startswith("dict:"):
        call = dict_entry(names, selector[5:])
        if call is None:
            raise Unresolved("not found")
        return [(f"{selector[5:]} · {arg}", text) for arg, text in string_keywords(call, names)]
    if selector.startswith("call:"):
        call = names.get(selector[5:])
        if not isinstance(call, ast.Call):
            raise Unresolved("not found")
        return [(f"{selector[5:]} · {arg}", text) for arg, text in string_keywords(call, names)]
    if selector.startswith("*"):
        found = []
        for name, value in names.items():
            if name.endswith(selector[1:]):
                try:
                    found.append((name, evaluate(value, names)))
                except Unresolved:
                    pass
        if not found:
            raise Unresolved("not found")
        return found
    if selector not in names:
        raise Unresolved("not found")
    return [(selector, evaluate(names[selector], names))]


def source_revision(repo: Path) -> str:
    try:
        return subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--from", dest="source", required=True, help="shorts_maker 저장소 경로")
    parser.add_argument("--out", default="knowledge", help="출력 폴더 (기본: knowledge)")
    options = parser.parse_args()

    repo = Path(options.source).expanduser().resolve()
    if not (repo / FS).is_dir():
        print(f"✗ {repo} 에 {FS} 가 없다 — shorts_maker 저장소 경로를 준다.", file=sys.stderr)
        return 2
    out = Path(options.out)
    out.mkdir(parents=True, exist_ok=True)
    revision = source_revision(repo)
    imported, skipped = [], []

    for filename, relative, selectors, title in SOURCES:
        try:
            sections, missing = extract(repo / relative, selectors)
        except (OSError, SyntaxError) as error:
            skipped.append(f"{filename}: {error}")
            continue
        skipped += [f"{filename}: {item}" for item in missing]
        if not sections:
            continue
        body = [f"# {title}", "", f"> 원문: shorts_maker@{revision} `{relative}` — 비공개. 커밋·공유 금지.", ""]
        for name, text in sections:
            body += [f"## {name}", "", text.strip(), ""]
        (out / filename).write_text("\n".join(body), encoding="utf-8")
        imported.append(filename)

    for target, relative in DIRECTORIES:
        source = repo / relative
        if not source.is_dir():
            skipped.append(f"{target}/: {relative} 없음")
            continue
        destination = out / target
        if destination.exists():
            shutil.rmtree(destination)
        destination.mkdir(parents=True)
        for file in sorted(source.glob("*.md")):
            shutil.copyfile(file, destination / file.name)
        imported.append(f"{target}/ ({len(list(destination.glob('*.md')))}개)")

    (out / "SOURCE.json").write_text(json.dumps({
        "source": "shorts_maker",
        "revision": revision,
        "importedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "files": imported,
        "skipped": skipped,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for item in imported:
        print(f"✓ {item}")
    for item in skipped:
        print(f"! 건너뜀 {item}")
    print(f"→ {out}/ (shorts_maker@{revision})")
    return 0 if imported else 1


if __name__ == "__main__":
    sys.exit(main())
