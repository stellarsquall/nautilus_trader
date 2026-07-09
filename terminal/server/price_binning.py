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

import math


def price_bin_trades(
    trades: list[tuple[float, float, str]],
    bin_size: float,
) -> list[dict[str, float]]:
    """
    Bin trades into price levels using the given bin size.

    Skips trades with zero or negative prices. Empty bins (no buy or sell volume)
    are omitted from the result. Each level price is computed as
    ``floor(price / bin_size) * bin_size``, ensuring consistent alignment.

    Parameters
    ----------
    trades : list[tuple[float, float, str]]
        List of ``(price, volume, side)`` tuples where ``side`` is ``"BUY"`` or
        ``"SELL"``.
    bin_size : float
        The price bin size (must be positive).

    Returns
    -------
    list[dict[str, float]]
        List of ``{"price": ..., "buy": ..., "sell": ...}`` dicts for non-empty
        bins, sorted by price ascending.

    """
    bins: dict[float, dict[str, float]] = {}

    for price, volume, side in trades:
        if price <= 0:
            continue

        bin_index = int(math.floor(price / bin_size))
        level_price = bin_index * bin_size

        if level_price not in bins:
            bins[level_price] = {"price": 0.0, "buy": 0.0, "sell": 0.0}

        v = float(volume)
        if side == "BUY":
            bins[level_price]["buy"] += v
        elif side == "SELL":
            bins[level_price]["sell"] += v

    return [
        {"price": price, "buy": data["buy"], "sell": data["sell"]}
        for price, data in sorted(bins.items())
        if data["buy"] != 0.0 or data["sell"] != 0.0
    ]