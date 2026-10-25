"""No interpolation of untrusted PR text into shell commands."""

import os
import re
import sys

body = os.environ.get("PR_BODY", "")
pattern = r"(?im)^\s*(?:closes|fixes|resolves)\s+(?:#\d+|https://github\.com/Vroote/AmIFooled/issues/\d+)\b"
if not re.search(pattern, body):
    sys.exit("PR description must contain: Closes #<issue-number>")
