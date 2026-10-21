import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const transportSource = readFileSync(new URL('../leafony.js', import.meta.url), 'utf8');
function screen({ supported = true, connectError, commandError, disconnectDuringConnect = false } = {}) {
  const nodes = new Map();
  const clients = [];
  const blobs = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      style: {}, disabled: false, textContent: '', listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; },
      click() { this.clicked = true; return this.listeners.click?.(); }
    });
    return nodes.get(id);
  };
  class FakeLeafony {
    constructor() { clients.push(this); this.commands = []; }
    disableSleep() {}
    onStateChange(fn) { this.receive = fn; }
    onDisconnected(fn) { this.lost = fn; }
    async connect() {
      if (connectError) throw connectError;
      if (disconnectDuringConnect) this.lost();
    }
    disconnect() { this.disconnected = true; this.lost(); }
    async sendCommand(command) { if (commandError) throw commandError; this.commands.push(command); }
  }
  vm.runInNewContext(source, {
    document: { getElementById: node }, navigator: supported ? { bluetooth: {} } : {},
    window: { isSecureContext: true }, Leafony: FakeLeafony,
    Date, Blob, URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout() {}
  });
  return { node, clients, blobs };
}

test('unsupported browsers explain the alternative and cannot start a connection', () => {
  const { node, clients } = screen({ supported: false });
  assert.equal(node('ble-connect-button').disabled, true);
  assert.match(node('connection-help').textContent, /Bluefy/);
  assert.equal(clients.length, 0);
});

test('cancelling the chooser restores the connect button without enabling commands', async () => {
  const { node } = screen({ connectError: { name: 'NotFoundError' } });
  await node('ble-connect-button').click();
  assert.equal(node('ble-connect-button').disabled, false);
  assert.equal(node('ble-disconnect-button').style.display, 'none');
  assert.equal(node('button-led-pls').disabled, true);
  assert.match(node('connection-status').textContent, /キャンセル/);
});

test('a service setup failure is visible and retryable', async () => {
  const { node } = screen({ connectError: new Error('GATT unavailable') });
  await node('ble-connect-button').click();
  assert.equal(node('ble-connect-button').disabled, false);
  assert.equal(node('button-led-mns').disabled, true);
  assert.match(node('connection-status').textContent, /接続できません/);
});

test('a disconnect during setup cannot be overwritten by a successful connection screen', async () => {
  const { node } = screen({ disconnectDuringConnect: true });
  await node('ble-connect-button').click();
  assert.equal(node('ble-connect-button').disabled, false);
  assert.equal(node('ble-disconnect-button').style.display, 'none');
  assert.equal(node('button-led-pls').disabled, true);
  assert.match(node('connection-status').textContent, /接続できません/);
});

test('receiving data enables CSV and retains the last values after an unexpected disconnect', async () => {
  const { node, clients, blobs } = screen();
  await node('ble-connect-button').click();
  assert.equal(node('button-led-pls').disabled, false);
  clients[0].receive({ devn: 'Leafony, demo', unin: 'Leafony_AC02', temp: '23.5', humd: '41', illm: '120', tilt: '2', batt: '2.9', dice: '1' });
  assert.equal(node('textTemp').textContent, '23.5');
  assert.equal(node('button-download').disabled, false);
  node('button-download').click();
  assert.match(await blobs[0].text(), /"Leafony, demo"/);
  assert.equal(node('downloader').clicked, true);
  clients[0].lost();
  assert.equal(node('textTemp').textContent, '23.5');
  assert.equal(node('button-led-pls').disabled, true);
  assert.equal(node('ble-connect-button').style.display, '');
});

test('LED commands retain the existing protocol and failures give a recovery instruction', async () => {
  const normal = screen();
  await normal.node('ble-connect-button').click();
  await normal.node('button-led-pls').click();
  await normal.node('button-led-mns').click();
  assert.deepEqual(normal.clients[0].commands, ['PLS', 'MNS']);
  const failed = screen({ commandError: new Error('disconnected') });
  await failed.node('ble-connect-button').click();
  await failed.node('button-led-pls').click();
  assert.match(failed.node('connection-help').textContent, /接続し直/);
});

test('the transport waits for notifications and propagates setup errors', async () => {
  let disconnected = false;
  const setupError = new Error('notifications failed');
  const device = { name: 'Leafony_AC02', id: 'test', addEventListener() {}, gatt: {
    connected: true,
    async connect() { return { async getPrimaryService() { return { async getCharacteristic() {
      return { async startNotifications() { throw setupError; } };
    } }; } }; },
    disconnect() { disconnected = true; }
  } };
  const context = vm.createContext({ navigator: { platform: 'MacIntel', bluetooth: { async requestDevice() { return device; } } }, console: { log() {} }, setTimeout() {} });
  vm.runInContext(transportSource, context);
  const client = vm.runInContext('new Leafony()', context);
  await assert.rejects(client.connect(), setupError);
  assert.equal(disconnected, true);
});
