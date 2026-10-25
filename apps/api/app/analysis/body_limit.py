"""Reject an oversized body before any JSON is parsed.

Pydantic limits fields after parsing; this ASGI middleware limits the bytes that reach
the parser at all. It is scoped to the analyze path so other endpoints are untouched.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

Scope = dict[str, Any]
Message = dict[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]

TOO_LARGE_DETAIL = "Request body is too large"


class BodySizeLimitMiddleware:
    def __init__(
        self,
        app: Callable[[Scope, Receive, Send], Awaitable[None]],
        *,
        max_bytes: int,
        paths: tuple[str, ...],
        methods: tuple[str, ...] = ("POST",),
    ) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.paths = paths
        self.methods = methods

    def _applies(self, scope: Scope) -> bool:
        return (
            scope.get("type") == "http"
            and scope.get("method") in self.methods
            and scope.get("path") in self.paths
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not self._applies(scope):
            await self.app(scope, receive, send)
            return

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    break
                if declared > self.max_bytes:
                    await self._reject(send)
                    return
                break

        body = bytearray()
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > self.max_bytes:
                await self._reject(send)
                return
            more_body = bool(message.get("more_body", False))

        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if replayed:
                return {"type": "http.disconnect"}
            replayed = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)

    async def _reject(self, send: Send) -> None:
        payload = json.dumps({"detail": TOO_LARGE_DETAIL}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(payload)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": payload, "more_body": False})
