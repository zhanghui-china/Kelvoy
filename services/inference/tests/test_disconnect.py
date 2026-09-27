"""A disconnected HTTP caller must stop its corresponding generation."""

import asyncio

import pytest

from inference.disconnect import run_while_connected


def test_disconnect_cancels_generation_and_waits_for_cleanup():
    class DisconnectedRequest:
        checks = 0

        async def is_disconnected(self):
            self.checks += 1
            return self.checks > 1

    async def scenario():
        started = asyncio.Event()
        cleaned = asyncio.Event()

        async def generation():
            started.set()
            try:
                await asyncio.sleep(60)
            finally:
                cleaned.set()

        with pytest.raises(asyncio.CancelledError):
            await run_while_connected(DisconnectedRequest(), generation())
        assert started.is_set()
        assert cleaned.is_set()

    asyncio.run(scenario())
