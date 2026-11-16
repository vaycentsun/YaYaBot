from pathlib import Path

import markdown


def _read(path):
    text = path.read_text(encoding="utf-8")
    title = path.stem
    description = ""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            title = stripped[2:].strip()
        elif stripped and not stripped.startswith(("#", "```", "|", "-")):
            description = stripped
            if title != path.stem:
                break
    return text, title, description


def list_documents(directory):
    documents = []
    for path in sorted(Path(directory).glob("*.md")):
        if path.is_file():
            _, title, description = _read(path)
            documents.append(
                {"name": path.name, "title": title, "description": description}
            )
    return documents


def get_document(directory, name):
    if Path(name).name != name or not name.endswith(".md"):
        raise FileNotFoundError(name)
    path = Path(directory) / name
    if not path.is_file():
        raise FileNotFoundError(name)
    text, title, description = _read(path)
    return {
        "name": name,
        "title": title,
        "description": description,
        "html": markdown.markdown(
            text, extensions=["fenced_code", "tables", "toc"]
        ),
    }
