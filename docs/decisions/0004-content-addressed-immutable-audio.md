# 4. Content-addressed immutable audio

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: makes audio conflict-free and uploads idempotent by construction.
The v2 app already never mutates audio in place; this makes it a rule.
