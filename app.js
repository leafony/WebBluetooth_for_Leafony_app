const fields = Object.fromEntries(
  ['DeviceName', 'UniqueName', 'DateTime', 'Temp', 'Humid', 'Illum', 'Tilt', 'Batt', 'Dice']
    .map(name => [name, document.getElementById('text' + name)])
);
const buttonConnect = document.getElementById('ble-connect-button');
const buttonDisconnect = document.getElementById('ble-disconnect-button');
const buttonLedPls = document.getElementById('button-led-pls');
const buttonLedMns = document.getElementById('button-led-mns');
const buttonDownload = document.getElementById('button-download');
const connectionStatus = document.getElementById('connection-status');
const connectionHelp = document.getElementById('connection-help');
const CSV_BUFF_LEN = 1024;
const savedData = [];
let leafony = null;
let connecting = false;

function setConnection(connected, message) {
  buttonConnect.style.display = connected ? 'none' : '';
  buttonDisconnect.style.display = connected ? '' : 'none';
  buttonLedPls.disabled = !connected;
  buttonLedMns.disabled = !connected;
  connectionStatus.textContent = message;
}

function updateTable(state) {
  const date = new Date();
  const pad = value => String(value).padStart(2, '0');
  const datetime = date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  const values = {
    DeviceName: state.devn, UniqueName: state.unin, DateTime: datetime,
    Temp: state.temp, Humid: state.humd, Illum: state.illm,
    Tilt: state.tilt, Batt: state.batt, Dice: state.dice
  };
  for (const [name, value] of Object.entries(values)) {
    fields[name].textContent = value === undefined || value === '' ? '—' : value;
  }
  if (savedData.length >= CSV_BUFF_LEN) savedData.shift();
  savedData.push([datetime, state.devn, state.unin, state.temp, state.humd,
    state.illm, state.tilt, state.batt, state.dice]);
  buttonDownload.disabled = false;
  connectionStatus.textContent = '測定値を受信しています';
  connectionHelp.textContent = '温度や湿度の値が表示されたら、最初の動作確認は完了です。';
}

buttonConnect.addEventListener('click', async () => {
  if (connecting || leafony) return;
  connecting = true;
  buttonConnect.disabled = true;
  connectionStatus.textContent = '接続先を選んでいます';
  connectionHelp.textContent = '一覧からLeafony_AC02を選び、ペア設定を進めてください。';
  const client = new Leafony();
  let disconnectedDuringConnect = false;
  leafony = client;
  client.disableSleep();
  client.onStateChange(state => {
    if (leafony === client) updateTable(state);
  });
  client.onDisconnected(() => {
    if (leafony !== client) return;
    if (connecting) {
      disconnectedDuringConnect = true;
      return;
    }
    leafony = null;
    setConnection(false, '接続が切れました');
    connectionHelp.textContent = '最後に受信した値を表示しています。もう一度接続できます。';
  });
  try {
    await client.connect();
    if (disconnectedDuringConnect) throw new Error('Disconnected while connecting');
    setConnection(true, '接続しました。測定値を待っています');
    connectionHelp.textContent = '測定値が届くまで少しお待ちください。表示されない場合は接続の確認をご覧ください。';
  } catch (error) {
    client.disconnect();
    leafony = null;
    const cancelled = error.name === 'NotFoundError' || error.name === 'AbortError';
    setConnection(false, cancelled ? '接続をキャンセルしました' : '接続できませんでした');
    connectionHelp.textContent = cancelled
      ? '電源とBluetoothを確認して、もう一度接続できます。'
      : 'キットの電源、対応ブラウザ、他の画面で接続中でないかを確認してください。';
  } finally {
    connecting = false;
    buttonConnect.disabled = false;
  }
});

buttonDisconnect.addEventListener('click', () => {
  const client = leafony;
  leafony = null;
  if (client) client.disconnect();
  setConnection(false, '接続を切りました');
  connectionHelp.textContent = '最後に受信した値を表示しています。もう一度接続できます。';
});

async function sendLedCommand(command) {
  if (!leafony) return;
  try {
    await leafony.sendCommand(command);
  } catch {
    connectionStatus.textContent = 'LEDの操作を送信できませんでした';
    connectionHelp.textContent = '接続が続いているか確認してください。必要なら接続し直してください。';
  }
}
buttonLedPls.addEventListener('click', () => sendLedCommand('PLS'));
buttonLedMns.addEventListener('click', () => sendLedCommand('MNS'));

buttonDownload.addEventListener('click', () => {
  if (!savedData.length) return;
  const csvCell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  const csv = 'Datetime,Device Name,Unique Name,Temp,Humid,Light,Tilt,BattVolt,Dice\n' +
    savedData.map(row => row.map(csvCell).join(',')).join('\n') + '\n';
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], {type: 'text/csv;charset=utf-8'}));
  const downloader = document.getElementById('downloader');
  downloader.download = 'data.csv';
  downloader.href = url;
  downloader.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

if (!navigator.bluetooth || !window.isSecureContext) {
  buttonConnect.disabled = true;
  connectionStatus.textContent = 'このブラウザではBluetooth接続を利用できません';
  connectionHelp.textContent = '対応するChrome、またはiPhone・iPadのBluefyで開いてください。端末ごとの手順は下のガイドで確認できます。';
}
