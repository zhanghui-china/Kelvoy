"""Tie one long-running inference operation to its HTTP caller."""

import asyncio
from collections.abc import Coroutine
from typing import Any, Protocol, TypeVar

T = TypeVar("T")


class DisconnectableRequest(Protocol):
    async def is_disconnected(self) -> bool: ...


async def run_while_connected(
    request: DisconnectableRequest, operation: Coroutine[Any, Any, T]
) -> T:
    task = asyncio.create_task(operation)
    try:
        while True:
            if task.done():
                return await task
            if await request.is_disconnected():
                raise asyncio.CancelledError("HTTP caller disconnected")
            await asyncio.wait({task}, timeout=0.25)
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
