import { ChartStore } from './store/ChartStore.js';
import { ViewManager } from './views/ViewManager.js';
import { ViewType } from './views/ChartView.js';
import { OverviewView } from './views/OverviewView.js';
import { FootprintView } from './views/FootprintView.js';
import { ViewToggleButton } from './ui/ViewToggleButton.js';
import type { Envelope, BarPayload, CvdPayload, FootprintPayload } from './types.js';

const container = document.getElementById('chart-container');
if (!container) {
  throw new Error('chart-container element not found');
}

const chartStore = new ChartStore();

const viewManager = new ViewManager(chartStore, container, (type) => {
  if (type === ViewType.Overview) return new OverviewView();
  return new FootprintView();
});

const toggle = new ViewToggleButton(container, {
  onViewSwitch: (viewType) => {
    const chartViewType = viewType === 'overview' ? ViewType.Overview : ViewType.Footprint;
    viewManager.switchToView(chartViewType);
    toggle.setViewType(viewType);
    // Footprint has a left price-axis gutter + top time header; move the view toggle
    // into the footprint safe zone (right of axis, below header). Overview keeps top-left.
    if (viewType === 'footprint') {
      toggle.setPosition('58px', '64px');
    } else {
      toggle.setPosition('60px', '8px');
    }
  },
});

viewManager.switchToView(ViewType.Overview);

const ws = new WebSocket(`ws://${window.location.host}/ws`);

ws.onmessage = (event) => {
  try {
    const envelope: Envelope = JSON.parse(event.data);

    switch (envelope.type) {
      case 'bar':
        chartStore.ingestBar(envelope.payload as BarPayload);
        viewManager.updateBar(envelope.payload);
        break;
      case 'cvd':
        chartStore.ingestCvd(envelope.payload as CvdPayload);
        viewManager.updateCvd(envelope.payload);
        break;
      case 'footprint':
        chartStore.ingestFootprint(envelope.payload as FootprintPayload);
        viewManager.updateFootprint(envelope.payload as FootprintPayload);
        break;
      default:
        console.warn(`Unknown message type: ${envelope.type}`);
    }
  } catch (error) {
    console.error('Failed to parse WebSocket message:', error);
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('WebSocket connection closed');
};