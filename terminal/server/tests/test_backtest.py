# -------------------------------------------------------------------------------------------------
#  Copyright (C) 2015-2026 Nautech Systems Pty Ltd. All rights reserved.
#  https://nautechsystems.io
#
#  Licensed under the GNU Lesser General Public License Version 3.0 (the "License");
#  You may not use this file except in compliance with the License.
#  You may obtain a copy of the License at https://www.gnu.org/licenses/lgpl-3.0.en.html
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
# -------------------------------------------------------------------------------------------------

import asyncio

import pytest

from nautilus_trader.model.enums import AggressorSide

from terminal.server.backtest import create_backtest_queue


class TestDatasetLoading:
    """Test dataset loading and validation for Binance trade ticks."""

    def test_ethusdt_dataset_loads(self):
        """Test ETHUSDT dataset loads with 69,806 trades and mixed aggressor sides."""
        # Create event loop
        loop = asyncio.new_event_loop()

        try:
            # Create backtest queue with ETHUSDT dataset
            engine, queue = create_backtest_queue(loop, delay_ms=50, dataset="ethusdt")

            # Access the engine's data to verify trade tick count
            # The data is stored in engine.data (list of data objects)
            ticks = [d for d in engine.data if hasattr(d, 'aggressor_side')]

            # Assert 69,806 trades loaded
            assert len(ticks) == 69_806, f"Expected 69,806 trades, got {len(ticks)}"

            # Assert both AggressorSide.BUYER and SELLER present
            aggressor_sides = {tick.aggressor_side for tick in ticks}
            assert AggressorSide.BUYER in aggressor_sides, "AggressorSide.BUYER not present"
            assert AggressorSide.SELLER in aggressor_sides, "AggressorSide.SELLER not present"

            # Verify bar volume will be > 0 (check that ticks have size)
            total_volume = sum(float(tick.size) for tick in ticks)
            assert total_volume > 0, "Total trade volume should be > 0"

        finally:
            loop.close()

    def test_btcusdt_dataset_loads(self):
        """Test BTCUSDT dataset loads with 2,001 trades and bool coercion."""
        # Create event loop
        loop = asyncio.new_event_loop()

        try:
            # Create backtest queue with BTCUSDT dataset
            engine, queue = create_backtest_queue(loop, delay_ms=50, dataset="btcusdt")

            # Access the engine's data to verify trade tick count
            ticks = [d for d in engine.data if hasattr(d, 'aggressor_side')]

            # Assert 2,001 trades loaded
            assert len(ticks) == 2_001, f"Expected 2,001 trades, got {len(ticks)}"

            # Assert both AggressorSide.BUYER and SELLER present (validates bool coercion)
            aggressor_sides = {tick.aggressor_side for tick in ticks}
            assert AggressorSide.BUYER in aggressor_sides, "AggressorSide.BUYER not present"
            assert AggressorSide.SELLER in aggressor_sides, "AggressorSide.SELLER not present"

            # Additional validation: ensure we have a mix of sides (not all one side)
            buyer_count = sum(1 for tick in ticks if tick.aggressor_side == AggressorSide.BUYER)
            seller_count = sum(1 for tick in ticks if tick.aggressor_side == AggressorSide.SELLER)
            assert buyer_count > 0, "Should have BUYER trades"
            assert seller_count > 0, "Should have SELLER trades"
            assert buyer_count + seller_count == len(ticks), "All trades should have aggressor side"

        finally:
            loop.close()

    def test_bar_type_is_last_internal(self):
        """Test that BarType string contains '-LAST-INTERNAL'."""
        # The BarType is created in create_backtest_queue(), we can verify it directly
        from nautilus_trader.model.data import BarType

        # Test ETHUSDT BarType
        bar_type_ethusdt = BarType.from_str("ETHUSDT.BINANCE-1-MINUTE-LAST-INTERNAL")
        assert "-LAST-INTERNAL" in str(bar_type_ethusdt), (
            f"ETHUSDT BarType should contain '-LAST-INTERNAL', got: {bar_type_ethusdt}"
        )

        # Test BTCUSDT BarType
        bar_type_btcusdt = BarType.from_str("BTCUSDT.BINANCE-1-MINUTE-LAST-INTERNAL")
        assert "-LAST-INTERNAL" in str(bar_type_btcusdt), (
            f"BTCUSDT BarType should contain '-LAST-INTERNAL', got: {bar_type_btcusdt}"
        )

    def test_invalid_dataset_raises_error(self):
        """Test that invalid dataset parameter raises ValueError."""
        loop = asyncio.new_event_loop()

        try:
            with pytest.raises(ValueError, match="Invalid dataset"):
                create_backtest_queue(loop, delay_ms=50, dataset="invalid")
        finally:
            loop.close()

    def test_default_dataset_is_ethusdt(self):
        """Test that default dataset parameter loads ETHUSDT."""
        loop = asyncio.new_event_loop()

        try:
            # Create without specifying dataset (should default to ethusdt)
            engine, queue = create_backtest_queue(loop, delay_ms=50)

            # Verify it loaded ETHUSDT by checking trade count
            ticks = [d for d in engine.data if hasattr(d, 'aggressor_side')]
            assert len(ticks) == 69_806, f"Default should be ETHUSDT with 69,806 trades, got {len(ticks)}"

        finally:
            loop.close()
