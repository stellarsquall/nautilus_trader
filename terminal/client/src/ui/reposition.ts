import type { LinkToggleButton } from './LinkToggleButton.js';
import type { ViewToggleButton } from './ViewToggleButton.js';

export type MainViewType = 'overview' | 'footprint';

/**
 * Reposition the view toggle and link toggle controls for the active view.
 *
 * Footprint has a left price-axis gutter + top time header, so the controls
 * move into the footprint safe zone (right of axis, below header). Overview
 * keeps them in the top-left gutter.
 */
export function repositionControls(
  toggle: ViewToggleButton,
  linkToggle: LinkToggleButton,
  viewType: MainViewType,
): void {
  if (viewType === 'footprint') {
    toggle.setPosition('58px', '64px');
    linkToggle.setPosition('110px', '64px');
  } else {
    // View toggle stays aligned at slot 2 (58/64) in both views; Link sits below
    // the extra Overview analytics (VP/VA), so it's lower than in Footprint.
    toggle.setPosition('58px', '64px');
    linkToggle.setPosition('162px', '64px');
  }
}
