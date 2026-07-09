"""Unit tests for price binning edge cases.

Covers the following acceptance criteria:
- Zero prices are skipped (no bin created)
- Negative prices are skipped (no bin created)
- Empty bins (zero buy AND sell volume) omitted from levels array
- Bin alignment: ``bin_index = floor(price / bin_size)``,
  ``level_price = bin_index * bin_size``
- Volume precision preserved as float64
"""

import math

import pytest

from terminal.server.price_binning import price_bin_trades


# ---------------------------------------------------------------------------
# Zero/negative prices are skipped
# ---------------------------------------------------------------------------


class TestSkipZeroNegativePrices:
    """AC: Price binning handles zero/negative prices (skip)."""

    def test_zero_price_skipped(self):
        """A trade with price=0.0 is skipped."""
        trades = [(0.0, 10.0, "BUY")]
        result = price_bin_trades(trades, bin_size=1.0)
        assert result == []

    def test_negative_price_skipped(self):
        """A trade with price=-5.0 is skipped."""
        trades = [(-5.0, 10.0, "SELL")]
        result = price_bin_trades(trades, bin_size=1.0)
        assert result == []

    def test_zero_and_positive_mixed(self):
        """Zero-price trades are skipped, positive trades are still binned."""
        trades = [
            (0.0, 5.0, "BUY"),
            (10.0, 10.0, "BUY"),
            (-3.0, 7.0, "SELL"),
            (20.0, 3.0, "SELL"),
        ]
        result = price_bin_trades(trades, bin_size=1.0)
        # Only the positive-price trades appear
        assert len(result) == 2
        assert result[0]["price"] == 10.0
        assert result[1]["price"] == 20.0

    def test_all_negative_prices_return_empty(self):
        """All trades with negative prices produce an empty result."""
        trades = [(-1.0, 1.0, "BUY"), (-100.0, 5.0, "SELL"), (-0.01, 2.0, "BUY")]
        result = price_bin_trades(trades, bin_size=1.0)
        assert result == []

    def test_all_zero_prices_return_empty(self):
        """All trades with zero price produce an empty result."""
        trades = [(0.0, 1.0, "BUY"), (0.0, 5.0, "SELL")]
        result = price_bin_trades(trades, bin_size=1.0)
        assert result == []


# ---------------------------------------------------------------------------
# Empty bins omitted from levels array
# ---------------------------------------------------------------------------


class TestEmptyBinsOmitted:
    """AC: Empty bins omitted from levels array."""

    def test_bin_with_zero_volume_omitted(self):
        """A bin level with zero buy AND zero sell volume is omitted."""
        # 10.0 and 30.0 have trades, but 20.0 has none
        trades = [
            (10.0, 5.0, "BUY"),
            (30.0, 3.0, "SELL"),
        ]
        result = price_bin_trades(trades, bin_size=10.0)
        prices = [level["price"] for level in result]
        assert 10.0 in prices
        assert 30.0 in prices
        assert 20.0 not in prices  # should not appear

    def test_bin_all_zeros_after_net_zero(self):
        """A bin that received buy and sell that cancel to zero total is still
        included because it has non-zero buy and sell volume individually."""
        trades = [
            (10.0, 5.0, "BUY"),
            (10.0, 5.0, "SELL"),
        ]
        result = price_bin_trades(trades, bin_size=10.0)
        # Bin should appear with buy=5.0, sell=5.0
        assert len(result) == 1
        assert result[0]["price"] == 10.0
        assert result[0]["buy"] == 5.0
        assert result[0]["sell"] == 5.0

    def test_partially_empty_bins_in_middle(self):
        """Gaps in price levels do not create empty bin entries."""
        trades = [
            (1.0, 2.0, "BUY"),
            (3.0, 4.0, "SELL"),
        ]
        result = price_bin_trades(trades, bin_size=1.0)
        prices = [level["price"] for level in result]
        assert prices == [1.0, 3.0]  # price=2.0 is absent

    def test_result_length_equals_non_empty_bins(self):
        """Result length matches number of bins with non-zero buy or sell."""
        trades = [
            (1.0, 10.0, "BUY"),
            (2.0, 0.0, "BUY"),  # zero volume on both sides — omitted
            (3.0, 5.0, "SELL"),
        ]
        result = price_bin_trades(trades, bin_size=1.0)
        assert len(result) == 2


# ---------------------------------------------------------------------------
# Bin alignment: bin_index = floor(price / bin_size), level_price = bin_index * bin_size
# ---------------------------------------------------------------------------


class TestBinAlignment:
    """AC: Bin alignment consistent with formula."""

    def test_bin_index_floor_division(self):
        """bin_index = floor(price / bin_size)."""
        # price=10.5, bin_size=5.0 => floor(10.5/5) = floor(2.1) = 2
        # level_price = 2 * 5.0 = 10.0
        trades = [(10.5, 1.0, "BUY")]
        result = price_bin_trades(trades, bin_size=5.0)
        assert len(result) == 1
        assert result[0]["price"] == 10.0
        assert result[0]["buy"] == 1.0

    def test_bin_index_exact_multiple(self):
        """price is an exact multiple of bin_size."""
        # price=20.0, bin_size=5.0 => floor(20/5) = 4, level_price = 4*5 = 20.0
        trades = [(20.0, 1.0, "SELL")]
        result = price_bin_trades(trades, bin_size=5.0)
        assert result[0]["price"] == 20.0

    def test_bin_index_rounds_down(self):
        """bin_index always floors, never rounds."""
        # price=14.99, bin_size=5.0 => floor(14.99/5) = floor(2.998) = 2
        # level_price = 2 * 5.0 = 10.0
        trades = [(14.99, 1.0, "BUY")]
        result = price_bin_trades(trades, bin_size=5.0)
        assert result[0]["price"] == 10.0

    def test_bin_index_just_above_threshold(self):
        """price just above a bin boundary floors to the lower bin."""
        # price=10.0001, bin_size=10.0 => floor(10.0001/10) = floor(1.00001) = 1
        # level_price = 1 * 10.0 = 10.0
        trades = [(10.0001, 1.0, "BUY")]
        result = price_bin_trades(trades, bin_size=10.0)
        assert result[0]["price"] == 10.0

    def test_bin_index_multiple_prices_same_bin(self):
        """Multiple prices in the same bin are aggregated."""
        # 10.0, 10.5, 14.99 all floor to bin_index=2 (bin_size=5.0)
        trades = [
            (10.0, 2.0, "BUY"),
            (10.5, 3.0, "BUY"),
            (14.99, 1.0, "SELL"),
        ]
        result = price_bin_trades(trades, bin_size=5.0)
        assert len(result) == 1
        assert result[0]["price"] == 10.0
        assert result[0]["buy"] == 5.0
        assert result[0]["sell"] == 1.0

    def test_bin_index_small_bin_size(self):
        """Small bin size (fractional) produces correct alignment."""
        # price=1.234, bin_size=0.1 => floor(1.234/0.1) = floor(12.34) = 12
        # level_price = 12 * 0.1 = 1.2
        trades = [(1.234, 1.0, "BUY")]
        result = price_bin_trades(trades, bin_size=0.1)
        assert result[0]["price"] == pytest.approx(1.2, abs=1e-12)

    def test_bin_index_large_bin_size(self):
        """Large bin size groups multiple price levels."""
        # price=50.0, bin_size=100.0 => floor(50/100) = 0, level_price = 0
        # price=150.0, bin_size=100.0 => floor(150/100) = 1, level_price = 100
        trades = [
            (50.0, 1.0, "BUY"),
            (150.0, 2.0, "SELL"),
        ]
        result = price_bin_trades(trades, bin_size=100.0)
        assert len(result) == 2
        assert result[0]["price"] == 0.0
        assert result[0]["buy"] == 1.0
        assert result[1]["price"] == 100.0
        assert result[1]["sell"] == 2.0


# ---------------------------------------------------------------------------
# Volume precision preserved as float64
# ---------------------------------------------------------------------------


class TestVolumePrecision:
    """AC: Volume precision preserved as float64."""

    def test_volume_is_float(self):
        """Volume values are Python float (float64)."""
        trades = [(10.0, 5.0, "BUY")]
        result = price_bin_trades(trades, bin_size=1.0)
        assert isinstance(result[0]["buy"], float)
        assert isinstance(result[0]["sell"], float)

    def test_volume_preserves_fractional(self):
        """Fractional volumes are preserved exactly."""
        trades = [(10.0, 0.123456789, "BUY")]
        result = price_bin_trades(trades, bin_size=1.0)
        assert result[0]["buy"] == pytest.approx(0.123456789, abs=1e-15)

    def test_volume_aggregation_float64(self):
        """Aggregated volumes remain float."""
        trades = [(10.0, 1.5, "BUY"), (10.0, 2.5, "BUY")]
        result = price_bin_trades(trades, bin_size=1.0)
        assert result[0]["buy"] == 4.0
        assert isinstance(result[0]["buy"], float)

    def test_volume_preserves_large_values(self):
        """Large volume values are preserved as float64."""
        trades = [(10.0, 1e12, "BUY")]
        result = price_bin_trades(trades, bin_size=1.0)
        assert result[0]["buy"] == 1e12
        assert isinstance(result[0]["buy"], float)

    def test_volume_preserves_small_values(self):
        """Very small volume values are preserved as float64."""
        trades = [(10.0, 1e-12, "SELL")]
        result = price_bin_trades(trades, bin_size=1.0)
        assert result[0]["sell"] == 1e-12
        assert isinstance(result[0]["sell"], float)


# ---------------------------------------------------------------------------
# Result order
# ---------------------------------------------------------------------------


class TestResultOrder:
    """Results are sorted by price ascending."""

    def test_results_sorted_by_price(self):
        """Levels are sorted by price ascending."""
        trades = [
            (30.0, 1.0, "BUY"),
            (10.0, 2.0, "SELL"),
            (20.0, 3.0, "BUY"),
        ]
        result = price_bin_trades(trades, bin_size=10.0)
        prices = [level["price"] for level in result]
        assert prices == [10.0, 20.0, 30.0]

    def test_unsorted_input_maintains_sorted_output(self):
        """Unsorted input trades produce sorted output levels."""
        trades = [
            (50.0, 5.0, "SELL"),
            (10.0, 5.0, "BUY"),
            (30.0, 5.0, "BUY"),
            (40.0, 5.0, "SELL"),
            (20.0, 5.0, "BUY"),
        ]
        result = price_bin_trades(trades, bin_size=10.0)
        prices = [level["price"] for level in result]
        assert prices == sorted(prices)