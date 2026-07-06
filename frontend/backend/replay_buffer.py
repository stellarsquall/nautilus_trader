"""Replay buffer for caching recent bar envelopes for late-joining WebSocket clients."""

import collections


class ReplayBuffer:
    """FIFO buffer for late-joining WebSocket clients.

    Uses collections.deque with maxlen for O(1) append and automatic eviction.
    When capacity is exceeded, oldest envelopes are automatically evicted.
    """

    def __init__(self, capacity: int = 100) -> None:
        """Initialize replay buffer with specified capacity.

        Parameters
        ----------
        capacity : int, default 100
            Maximum number of envelopes to cache. Oldest are evicted when exceeded.
        """
        self._capacity = capacity
        self._buffer: collections.deque = collections.deque(maxlen=capacity)

    def add(self, envelope: dict) -> None:
        """Add envelope to buffer.

        If buffer is at capacity, oldest envelope is automatically evicted.

        Parameters
        ----------
        envelope : dict
            WebSocket envelope to cache (contains v, type, seq, payload).
        """
        self._buffer.append(envelope)

    def get_all(self) -> list[dict]:
        """Return all cached envelopes in chronological order.

        Returns
        -------
        list[dict]
            List of envelopes from oldest to newest.
        """
        return list(self._buffer)
