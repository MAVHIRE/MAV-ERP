/**
 * MAV HIRE ERP — js/utils/state.js
 * Centralised shared state. Import { STATE } wherever needed.
 * Panes update STATE directly; other panes read from it.
 */

export const STATE = {
  // Loaded data caches
  products:    [],
  jobs:        [],
  quotes:      [],
  clients:     [],
  suppliers:   [],
  maintenance: [],
  skuStats:    [],
  forecasts:   [],
  services:    [],
  bundles:     [],
  invoices:    [],
  subRentals:      [],
  crew:            [],
  purchaseOrders:  [],

  // Company settings (from GAS Settings sheet)
  settings: null,

  // UI state
  activePane:  'dashboard',
  loadedPanes: new Set(),

  // Scan station
  scanMode:     'out',
  scanJobId:    null,
  scanJobItems: [],

  // Dashboard snapshot
  dashboard: null,

  // GAS URL
  gasUrl: localStorage.getItem('mav_gas_url') || '',
};