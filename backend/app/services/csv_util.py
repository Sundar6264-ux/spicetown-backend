"""Tiny shared CSV-from-dicts helper for the various small report exports
(barcode reports, price change log) - not the main orders export, which has
its own richer column mapping in services/export.py.
"""


def rows_to_csv(rows: list[dict]) -> str:
    if not rows:
        return ""
    headers = list(rows[0].keys())
    lines = [",".join(headers)]
    for row in rows:
        values = []
        for h in headers:
            val = row.get(h)
            text = "" if val is None else str(val)
            if "," in text or '"' in text:
                text = '"' + text.replace('"', '""') + '"'
            values.append(text)
        lines.append(",".join(values))
    return "\n".join(lines) + "\n"
