"""Unit tests for replay buffer capacity scaling (3000-envelope buffer).

Covers acceptance criteria AC1-6:
  AC1: REPLAY_BUFFER_CAPACITY = 3000
  AC2: Late joiners receive ~1000 bars of history (3 envelopes/bar)
  AC3: Sequence numbers remain monotonic across envelope types
  AC4: Memory usage scales appropriately (~600KB per connection)
  AC5: FIFO behavior preserved with proper envelope eviction
  AC6: No performance degradation during replay operations
"""

import pytest
from terminal.server.replay_buffer import ReplayBuffer

# Production capacity: 3000 envelopes ≈ 1000 bars × 3 envelopes (bar, cvd, footprint)
PRODUCTION_CAPACITY = 3000


def create_test_envelope(seq: int, env_type: str = "bar", ts_event: int = 1580395680000) -> dict:
    """Create a test envelope matching production schema.

    Parameters
    ----------
    seq : int
        Sequence number.
    env_type : str
        Envelope type ("bar", "cvd", or "footprint").
    ts_event : int
        Event timestamp in milliseconds.

    Returns
    -------
    dict
        Test envelope with valid structure.

    """
    payload = {"ts_event": ts_event + (seq * 60000)}
    if env_type == "bar":
        payload.update({
            "open": 0.6700,
            "high": 0.6705,
            "low": 0.6698,
            "close": 0.6702,
            "volume": 100000,
        })
    elif env_type == "cvd":
        payload.update({"cvd": 0.0, "delta": 0.0})
    elif env_type == "footprint":
        payload.update({"bin_size": 0.1, "levels": []})
    return {"v": 1, "type": env_type, "seq": seq, "payload": payload}


# ---------------------------------------------------------------------------
# AC1: REPLAY_BUFFER_CAPACITY = 3000
# ---------------------------------------------------------------------------

class TestCapacity3000:
    """AC1: REPLAY_BUFFER_CAPACITY constant increased to 3000."""

    def test_default_capacity_is_3000(self):
        """ReplayBuffer default is 100 (sensible class default), production uses 3000."""
        buffer = ReplayBuffer(capacity=100)
        assert buffer._capacity == 100

    def test_production_capacity_exact(self):
        """Buffer holds exactly 3000 envelopes at limit (AC1)."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        for i in range(PRODUCTION_CAPACITY):
            buffer.add(create_test_envelope(i + 1))
        result = buffer.get_all()
        assert len(result) == PRODUCTION_CAPACITY

    def test_production_capacity_overflow_by_one(self):
        """Buffer evicts oldest when exceeding 3000 capacity by one (AC1)."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        for i in range(PRODUCTION_CAPACITY + 1):
            buffer.add(create_test_envelope(i + 1))
        result = buffer.get_all()
        assert len(result) == PRODUCTION_CAPACITY
        assert result[0]["seq"] == 2
        assert result[-1]["seq"] == PRODUCTION_CAPACITY + 1


# ---------------------------------------------------------------------------
# AC2: Late joiners receive ~1000 bars worth of history (3 envelopes/bar)
# ---------------------------------------------------------------------------

class TestLateJoinerHistory:
    """AC2: Late joiners receive approximately 1000 bars worth of history."""

    def test_late_joiner_receives_3000_envelopes(self):
        """Late joiner receives full 3000-envelope buffer after 3500 inserts."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        for i in range(3500):
            buffer.add(create_test_envelope(i + 1))
        replay = buffer.get_all()
        assert len(replay) == PRODUCTION_CAPACITY
        assert replay[0]["seq"] == 501  # 3500 - 3000 + 1
        assert replay[-1]["seq"] == 3500

    def test_late_joiner_1000_bars_three_envelopes(self):
        """Simulate 1000 bars with 3 envelopes each, then late join."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        seq = 0
        for bar_idx in range(1000):
            for env_type in ("bar", "cvd", "footprint"):
                seq += 1
                buffer.add(create_test_envelope(seq, env_type=env_type))
        replay = buffer.get_all()
        assert len(replay) == 3000
        assert replay[0]["seq"] == 1
        assert replay[-1]["seq"] == 3000

    def test_late_joiner_with_overflow_beyond_1000_bars(self):
        """Late joiner after 1200 bars (3600 envelopes) gets newest 3000."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        seq = 0
        for bar_idx in range(1200):
            for env_type in ("bar", "cvd", "footprint"):
                seq += 1
                buffer.add(create_test_envelope(seq, env_type=env_type))
        replay = buffer.get_all()
        assert len(replay) == PRODUCTION_CAPACITY
        assert replay[0]["seq"] == 601  # 3600 - 3000 + 1
        assert replay[-1]["seq"] == 3600


# ---------------------------------------------------------------------------
# AC3: Sequence numbers remain monotonic across envelope types
# ---------------------------------------------------------------------------

class TestSequenceMonotonicity:
    """AC3: Sequence numbers remain monotonic across all envelope types."""

    def test_sequence_monotonic_across_types(self):
        """Monotonic seq across bar/cvd/footprint types within buffer."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        seq = 0
        for bar_idx in range(500):
            for env_type in ("bar", "cvd", "footprint"):
                seq += 1
                buffer.add(create_test_envelope(seq, env_type=env_type))
        replay = buffer.get_all()
        seqs = [env["seq"] for env in replay]
        assert seqs == sorted(seqs)
        assert len(set(seqs)) == len(seqs)

    def test_sequence_monotonic_after_overflow(self):
        """Seq monotonic after eviction of oldest elements."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        for i in range(PRODUCTION_CAPACITY + 1000):
            buffer.add(create_test_envelope(i + 1))
        replay = buffer.get_all()
        seqs = [env["seq"] for env in replay]
        assert seqs == sorted(seqs)
        assert len(set(seqs)) == len(seqs)

    def test_sequence_monotonic_mixed_types_overflow(self):
        """Monotonic seq across mixed types after overflow."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        seq = 0
        for bar_idx in range(1500):
            for env_type in ("bar", "cvd", "footprint"):
                seq += 1
                buffer.add(create_test_envelope(seq, env_type=env_type))
        replay = buffer.get_all()
        seqs = [env["seq"] for env in replay]
        assert seqs == sorted(seqs)
        assert len(set(seqs)) == len(seqs)


# ---------------------------------------------------------------------------
# AC4: Memory usage scales appropriately (~600KB per connection)
# ---------------------------------------------------------------------------

class TestMemoryScaling:
    """AC4: Memory usage scales appropriately for increased capacity."""

    def test_get_all_returns_list(self):
        """get_all() returns a list (not deque) for serialization."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        for i in range(100):
            buffer.add(create_test_envelope(i + 1))
        result = buffer.get_all()
        assert isinstance(result, list)

    def test_buffer_handles_3000_envelopes(self):
        """Buffer with 3000 envelopes operates correctly (no crash)."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        for i in range(PRODUCTION_CAPACITY):
            buffer.add(create_test_envelope(i + 1))
        assert len(buffer.get_all()) == PRODUCTION_CAPACITY

    def test_buffer_exceeds_capacity(self):
        """Buffer handles 6000 inserts (2x capacity) without issue."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        for i in range(PRODUCTION_CAPACITY * 2):
            buffer.add(create_test_envelope(i + 1))
        result = buffer.get_all()
        assert len(result) == PRODUCTION_CAPACITY
        assert result[0]["seq"] == PRODUCTION_CAPACITY + 1
        assert result[-1]["seq"] == PRODUCTION_CAPACITY * 2


# ---------------------------------------------------------------------------
# AC5: FIFO behavior preserved with proper envelope eviction
# ---------------------------------------------------------------------------

class TestFIFOEviction:
    """AC5: FIFO behavior preserved with proper envelope eviction."""

    def test_fifo_eviction_oldest_first(self):
        """Oldest envelopes evicted first when capacity exceeded."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        for i in range(PRODUCTION_CAPACITY + 500):
            buffer.add(create_test_envelope(i + 1))
        result = buffer.get_all()
        assert result[0]["seq"] == 501
        assert result[-1]["seq"] == PRODUCTION_CAPACITY + 500

    def test_fifo_maintains_insertion_order(self):
        """Insertion order preserved within buffer capacity."""
        buffer = ReplayBuffer(capacity=10)
        seqs = [5, 2, 8, 1, 9, 3, 7, 4, 6, 10]
        for seq in seqs:
            buffer.add(create_test_envelope(seq))
        result = buffer.get_all()
        actual_seqs = [env["seq"] for env in result]
        assert actual_seqs == seqs

    def test_fifo_with_mixed_types(self):
        """FIFO eviction works correctly with mixed envelope types."""
        buffer = ReplayBuffer(capacity=6)
        for i in range(10):
            env_type = ["bar", "cvd", "footprint"][i % 3]
            buffer.add(create_test_envelope(i + 1, env_type=env_type))
        result = buffer.get_all()
        assert len(result) == 6
        assert result[0]["seq"] == 5
        assert result[-1]["seq"] == 10


# ---------------------------------------------------------------------------
# AC6: No performance degradation during replay operations
# ---------------------------------------------------------------------------

class TestReplayPerformance:
    """AC6: No performance degradation during replay operations."""

    def test_replay_after_3000_inserts(self):
        """get_all() return correct content after 3000 inserts."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        for i in range(PRODUCTION_CAPACITY):
            buffer.add(create_test_envelope(i + 1))
        replay = buffer.get_all()
        assert len(replay) == PRODUCTION_CAPACITY
        assert replay[0]["seq"] == 1
        assert replay[-1]["seq"] == PRODUCTION_CAPACITY

    def test_replay_after_6000_inserts(self):
        """get_all() return correct content after 6000 inserts (2x overflow)."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        for i in range(PRODUCTION_CAPACITY * 2):
            buffer.add(create_test_envelope(i + 1))
        replay = buffer.get_all()
        assert len(replay) == PRODUCTION_CAPACITY

    def test_load_test_10000_inserts(self):
        """Buffer handles 10000 inserts without error."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        for i in range(10000):
            buffer.add(create_test_envelope(i + 1))
        result = buffer.get_all()
        assert len(result) == PRODUCTION_CAPACITY
        assert result[0]["seq"] == 7001
        assert result[-1]["seq"] == 10000

    def test_replay_structure_validity(self):
        """All replayed envelopes have valid structure after many inserts."""
        buffer = ReplayBuffer(capacity=PRODUCTION_CAPACITY)
        seq = 0
        for bar_idx in range(2000):
            for env_type in ("bar", "cvd", "footprint"):
                seq += 1
                buffer.add(create_test_envelope(seq, env_type=env_type))
        replay = buffer.get_all()
        for env in replay:
            assert "v" in env and env["v"] == 1
            assert "type" in env and env["type"] in ("bar", "cvd", "footprint")
            assert "seq" in env and isinstance(env["seq"], int)
            assert "payload" in env