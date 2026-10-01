global.HTMLElement = class {};
const fs = require('fs');
const path = require('path');

let Panel;
global.customElements = {
  get: () => null,
  define: (_name, value) => {
    Panel = value;
  },
};

require('../custom_components/print_orbit/frontend/panel.js');

const panelSource = fs.readFileSync(
  path.join(__dirname, '../custom_components/print_orbit/frontend/panel.js'),
  'utf8',
);

for (const requiredPattern of [
  '<ha-card',
  '<ha-button',
  "document.createElement('ha-alert')",
  "customElements.define('print-orbit-panel'",
  '`print_orbit/${path}`',
  "files/remote-delete",
  'Delete from printers',
  'var(--primary-color)',
  '@media (max-width:600px)',
]) {
  if (!panelSource.includes(requiredPattern)) {
    throw new Error(`Missing Home Assistant UI pattern: ${requiredPattern}`);
  }
}

if (panelSource.includes('/api/centauri_file_sync/')) {
  throw new Error('Legacy API route remains in the Print Orbit panel');
}

if (!panelSource.includes('window.confirm')) {
  throw new Error('Remote deletion is missing explicit confirmation');
}

const panel = new Panel();
const validAddresses = [
  '192.168.1.51',
  '10.0.0.1',
  '0.0.0.0',
  '255.255.255.255',
];
const invalidAddresses = [
  '',
  '192.168.1',
  '192.168.1.256',
  '192.168.01.1',
  'printer.local',
  '1.2.3.4.5',
];

for (const address of validAddresses) {
  if (!panel._isIPv4(address)) throw new Error(`Expected valid IPv4 address: ${address}`);
}

for (const address of invalidAddresses) {
  if (panel._isIPv4(address)) throw new Error(`Expected invalid IPv4 address: ${address}`);
}

if (panel._errorMessage({ detail: 'Printer host must be an IPv4 address' }) !== 'Printer host must be an IPv4 address') {
  throw new Error('Top-level API detail was not extracted');
}

if (panel._errorMessage({ body: { detail: 'Nested detail' } }) !== 'Nested detail') {
  throw new Error('Nested API detail was not extracted');
}
