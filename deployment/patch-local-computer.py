#!/usr/bin/env python3
"""Apply OpenDots' host-workspace shell integration to the pinned OpenBot checkout."""
from pathlib import Path
import sys


root = Path(sys.argv[1])
replacements = {
    root / "agent-computer/src/browser-runtime.ts": [
        ("allowExec: !local,", 'allowExec: !local || env.COMPUTER_ALLOW_EXEC === "on",'),
    ],
    root / "agent-computer/src/index.ts": [
        (
            'const shell = createShell(process.env.WORKSPACE_DIR?.trim() || "/workspace");',
            'const shellRoot = process.env.WORKSPACE_DIR?.trim() || "/workspace";',
        ),
        (
            'if (url.pathname === "/exec" && request.method === "POST") {',
            'if (url.pathname === "/exec" && request.method === "POST") {\n'
            '        const dotWorkspace = join(shellRoot, botId);\n'
            '        await mkdir(dotWorkspace, { recursive: true, mode: 0o700 });\n'
            '        const dotShell = createShell(dotWorkspace);',
        ),
        ('await shell.run({', 'await dotShell.run({'),
    ],
}

for filename, edits in replacements.items():
    source = filename.read_text()
    for old, new in edits:
        count = source.count(old)
        if count == 1:
            source = source.replace(old, new)
        elif count == 0 and source.count(new) == 1:
            # The installer can be rerun against its existing pinned checkout.
            # Accept the exact patched form instead of failing or patching twice.
            continue
        else:
            raise SystemExit(f"Expected one patch point in {filename}, found {count}: {old!r}")
    filename.write_text(source)
