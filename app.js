/**
 * LIN 设备通讯助手 - 应用入口
 */

const { BleManager } = require('./utils/ble-manager')
const storage = require('./services/storage')
const { initDefaultProfiles } = require('./data/profiles')

App({
  globalData: {
    bleManager: null,
    connected: false,
    connectedDeviceId: '',
    connectedDeviceName: '',
    currentMode: 1,
    settings: {},
    lastReceivedBytes: null,
    lastParsedFrame: null,
    lastSendHex: '',
    frameHistory: [],
    logs: []
  },

  onLaunch() {
    console.log('LIN 设备通讯助手 启动')

    // 首次启动时导入默认设备配置
    initDefaultProfiles(storage)

    this.globalData.settings = storage.getSettings()
    this.globalData.frameHistory = storage.getFrameHistory()
    this.globalData.logs = storage.getLogs()

    this._initBleManager()
  },

  _initBleManager() {
    const settings = this.globalData.settings
    const svcCfg = storage.getBLEServiceConfig()

    this.globalData.bleManager = new BleManager({
      serviceConfig: svcCfg || undefined,
      scanTimeout: settings.scanTimeout,
      connectTimeout: settings.connectTimeout,
      autoReconnect: settings.autoReconnect,
      maxReconnectAttempts: settings.maxReconnectAttempts,

      onLog: (msg) => {
        console.log('[BLE]', msg)
        this.globalData.logs = storage.addLog(msg)
        this._notifyPages('onBleLog', { msg })
      },

      onDeviceFound: (device) => {
        if (!device.name || device.name === 'N/A') return
        this._notifyPages('onBleDeviceFound', { device })
      },

      onStatusChange: (state, msg) => {
        const isConnected = state === 'connected'
        this.globalData.connected = isConnected
        if (state === 'disconnected' || state === 'error') {
          this.globalData.connected = false
        }
        this._notifyPages('onBleStatusChange', { state, msg, isConnected })
      },

      onReceiveData: (bytes) => {
        const { parseReceivedFrame, bytesToHex } = require('./utils/lin-protocol')
        const hex = bytesToHex(bytes)
        const parsed = parseReceivedFrame(bytes)

        this.globalData.lastReceivedBytes = bytes
        this.globalData.lastParsedFrame = parsed

        const frame = {
          time: _nowTime(),
          direction: 'receive',
          rawHex: hex,
          ...parsed
        }

        this.globalData.frameHistory = storage.addFrame(frame)

        this._notifyPages('onBleReceiveData', {
          bytes,
          hex,
          parsed,
          frameHistory: this.globalData.frameHistory
        })
      },

      onSendNum: (num) => {
        this._notifyPages('onBleSendNum', { num })
      },

      onRSSI: (rssi) => {
        this._notifyPages('onBleRSSI', { rssi })
      }
    })
  },

  _notifyPages(eventName, data) {
    const pages = getCurrentPages()
    for (const page of pages) {
      if (page[eventName] && typeof page[eventName] === 'function') {
        try {
          page[eventName](data)
        } catch (e) {
          console.error('页面事件处理错误:', eventName, e)
        }
      }
    }
  }
})

function _nowTime() {
  const now = new Date()
  return [
    now.getHours().toString().padStart(2, '0'),
    now.getMinutes().toString().padStart(2, '0'),
    now.getSeconds().toString().padStart(2, '0')
  ].join(':')
}
