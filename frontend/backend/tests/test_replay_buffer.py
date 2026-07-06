"""Unit tests for ReplayBuffer capacity enforcement, FIFO eviction, and chronological ordering."""

import pytest
from frontend.backend.replay_buffer import ReplayBuffer


def create_test_envelope(seq: int, ts_event: int = 1580395680000) -> dict:
    """Create a test envelope matching production schema.

    Parameters
    ----------
    seq : int
        Sequence number for the envelope.
    ts_event : int, default 1580395680000
        Event timestamp in milliseconds.

    Returns
    -------
    dict
        Test envelope with valid structure.
    """
    return {
        "v": 1,
        "type": "bar",
        "seq": seq,
        "payload": {
            "ts_event": ts_event + (seq * 60000),  # 1-minute intervals
            "open": 0.6700 + (seq * 0.0001),
            "high": 0.6705 + (seq * 0.0001),
            "low": 0.6698 + (seq * 0.0001),
            "close": 0.6702 + (seq * 0.0001),
            "volume": 100000,
        },
    }


class TestReplayBufferCapacity:
    """Test capacity enforcement and overflow behavior."""

    def test_buffer_respects_capacity_exact(self):
        """Test buffer holds exactly capacity elements when at limit."""
        capacity = 100
        buffer = ReplayBuffer(capacity=capacity)

        # Add exactly capacity elements
        for i in range(capacity):
            buffer.add(create_test_envelope(i + 1))

        result = buffer.get_all()
        assert len(result) == capacity, f"Expected {capacity} elements, got {len(result)}"

    def test_buffer_respects_capacity_overflow_by_one(self):
        """Test buffer evicts oldest when exceeding capacity by one."""
        capacity = 100
        buffer = ReplayBuffer(capacity=capacity)

        # Add capacity + 1 elements
        for i in range(capacity + 1):
            buffer.add(create_test_envelope(i + 1))

        result = buffer.get_all()
        assert len(result) == capacity, f"Expected {capacity} elements, got {len(result)}"

        # First element should be seq=2 (seq=1 was evicted)
        assert result[0]["seq"] == 2, "Oldest element not evicted"
        assert result[-1]["seq"] == capacity + 1, "Newest element not present"

    def test_buffer_respects_capacity_overflow_by_many(self):
        """Test buffer maintains capacity after adding 150 elements to capacity-100 buffer (AC4)."""
        capacity = 100
        buffer = ReplayBuffer(capacity=capacity)

        # Add 150 envelopes to capacity=100 buffer
        for i in range(150):
            buffer.add(create_test_envelope(i + 1))

        result = buffer.get_all()
        assert len(result) == 100, "Buffer should contain exactly 100 elements after adding 150"

        # Should contain envelopes 51-150 (most recent 100)
        assert result[0]["seq"] == 51, "Oldest element should be seq=51"
        assert result[-1]["seq"] == 150, "Newest element should be seq=150"

    def test_buffer_handles_small_capacity(self):
        """Test buffer with small capacity (edge case)."""
        buffer = ReplayBuffer(capacity=3)

        for i in range(10):
            buffer.add(create_test_envelope(i + 1))

        result = buffer.get_all()
        assert len(result) == 3, "Buffer should respect small capacity"
        assert result[0]["seq"] == 8, "Should contain last 3 elements"
        assert result[-1]["seq"] == 10


class TestReplayBufferFIFOOrdering:
    """Test FIFO eviction (oldest evicted first)."""

    def test_fifo_ordering_evicts_oldest_first(self):
        """Test oldest envelopes are evicted first when capacity exceeded."""
        buffer = ReplayBuffer(capacity=5)

        # Add 10 envelopes with distinct sequence numbers
        for i in range(10):
            buffer.add(create_test_envelope(i + 1))

        result = buffer.get_all()
        assert len(result) == 5, "Buffer should contain exactly 5 elements"

        # Should contain seq 6-10 (first 5 were evicted in FIFO order)
        expected_seqs = [6, 7, 8, 9, 10]
        actual_seqs = [env["seq"] for env in result]
        assert actual_seqs == expected_seqs, f"FIFO ordering violated: {actual_seqs}"

    def test_fifo_ordering_maintains_insertion_order(self):
        """Test envelopes remain in insertion order within buffer."""
        buffer = ReplayBuffer(capacity=10)

        # Add envelopes with non-sequential timestamps
        seqs = [5, 2, 8, 1, 9, 3, 7, 4, 6, 10]
        for seq in seqs:
            buffer.add(create_test_envelope(seq))

        result = buffer.get_all()
        actual_seqs = [env["seq"] for env in result]

        # Should match insertion order, not sorted order
        assert actual_seqs == seqs, f"Insertion order not preserved: {actual_seqs}"


class TestReplayBufferChronologicalOrder:
    """Test get_all() returns envelopes in chronological order (oldest to newest)."""

    def test_get_all_chronological_order(self):
        """Test get_all() returns list in chronological order (oldest to newest)."""
        buffer = ReplayBuffer(capacity=20)

        # Add 20 envelopes
        for i in range(20):
            buffer.add(create_test_envelope(i + 1))

        result = buffer.get_all()

        # Verify chronological order by checking timestamps are monotonically increasing
        timestamps = [env["payload"]["ts_event"] for env in result]
        assert timestamps == sorted(timestamps), "Timestamps not in chronological order"

        # Verify sequence numbers are also monotonic
        seqs = [env["seq"] for env in result]
        assert seqs == sorted(seqs), "Sequence numbers not in chronological order"

        # First should be oldest (seq=1), last should be newest (seq=20)
        assert result[0]["seq"] == 1, "First element should be oldest"
        assert result[-1]["seq"] == 20, "Last element should be newest"

    def test_get_all_empty_buffer(self):
        """Test get_all() returns empty list for empty buffer."""
        buffer = ReplayBuffer(capacity=100)
        result = buffer.get_all()
        assert result == [], "Empty buffer should return empty list"
        assert isinstance(result, list), "get_all() should return a list"

    def test_get_all_single_element(self):
        """Test get_all() with single element."""
        buffer = ReplayBuffer(capacity=100)
        envelope = create_test_envelope(1)
        buffer.add(envelope)

        result = buffer.get_all()
        assert len(result) == 1, "Should contain one element"
        assert result[0] == envelope, "Should return the exact envelope"


class TestReplayBufferIntegration:
    """Integration tests for realistic usage patterns."""

    def test_realistic_usage_pattern(self):
        """Test realistic usage: progressive bar accumulation with late joiner."""
        buffer = ReplayBuffer(capacity=100)

        # Simulate backtest emitting 200 bars
        for i in range(200):
            buffer.add(create_test_envelope(i + 1))

        # Late joiner receives replay buffer
        replay = buffer.get_all()

        assert len(replay) == 100, "Late joiner should receive 100 bars"
        assert replay[0]["seq"] == 101, "Should start from bar 101"
        assert replay[-1]["seq"] == 200, "Should end with bar 200"

        # Verify all replayed bars have valid structure
        for env in replay:
            assert "v" in env and env["v"] == 1
            assert "type" in env and env["type"] == "bar"
            assert "seq" in env and isinstance(env["seq"], int)
            assert "payload" in env
            assert "ts_event" in env["payload"]

    def test_multiple_get_all_calls_consistent(self):
        """Test multiple get_all() calls return consistent results."""
        buffer = ReplayBuffer(capacity=50)

        for i in range(75):
            buffer.add(create_test_envelope(i + 1))

        result1 = buffer.get_all()
        result2 = buffer.get_all()

        assert result1 == result2, "Multiple get_all() calls should return identical results"
        assert len(result1) == 50, "Should contain exactly capacity elements"
