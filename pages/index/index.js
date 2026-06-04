/**
 * 首页 - 设备扫描与连接
 */

const app = getApp()
const storage = require('../../services/storage')
const { MODE } = require('../../utils/lin-protocol')

Page({
  data: {
    // 连接状态
    devices: [],
    statusText: '未连接',
    isConnected: false,
    isScanning: false,
    connectedDeviceName: '',
    connectedDeviceId: '',

    // 模式选择
    modeIndex: 1,  // 默认主模式
    modeOptions: [
      { label: '监听模式', value: MODE.MONITOR },
      { label: '主模式',   value: MODE.MASTER },
      { label: '从机模式', value: MODE.SLAVE },
      { label: '嗅探模式', value: MODE.SNIFFER }
    ],

    // UI
    showDeviceList: false,
    rssi: null
  },

  onLoad() {
    this.ble = app.globalData.bleManager
    this._syncState()
  },

  onShow() {
    this._syncState()
  },

  _syncState() {
    const g = app.globalData
    this.setData({
      isConnected: g.connected,
      connectedDeviceName: g.connectedDeviceName,
      connectedDeviceId: g.connectedDeviceId
    })
  },

  // 全局事件 (由 app.js notifyPages 调用)
  onBleDeviceFound(data) {
    if (!data || !data.device) return
    const device = data.device

    const devices = [...this.data.devices]
    const idx = devices.findIndex(d => d.deviceId === device.deviceId)
    if (idx >= 0) {
      devices[idx] = device
    } else {
      devices.push(device)
    }
    // 按 RSSI 降序
    devices.sort((a, b) => (b.RSSI || -999) - (a.RSSI || -999))
    this.setData({ devices })
  },

  onBleStatusChange(data) {
    this.setData({
      statusText: this._translateStatus(data.state, data.msg),
      isConnected: data.isConnected,
      isScanning: data.state === 'scanning'
    })
    if (data.isConnected) {
      this.setData({ showDeviceList: false })
      this._syncState()
    }
  },

  onBleRSSI(data) {
    this.setData({ rssi: data.rssi })
  },

  onBleLog(data) {
    // 日志由 terminal/logs 页面处理
  },

  _translateStatus(state, msg) {
    const map = {
      scanning: '扫描中...',
      scanned: '扫描结束',
      connecting: '连接中...',
      connected: '已连接',
      disconnected: '未连接',
      error: '错误'
    }
    const text = map[state] || state || '未知'
    return msg ? text + ': ' + msg : text
  },

  // ─── 扫描 ──────────────────────────────────────

  async handleScan() {
    try {
      this.setData({ devices: [], showDeviceList: true })
      await this.ble.startScan(10000)
    } catch (e) {
      this.setData({ statusText: '扫描失败' })
      wx.showToast({ title: '扫描失败', icon: 'none' })
    }
  },

  // ─── 连接 ──────────────────────────────────────

  async handleAutoConnect() {
    const saved = storage.getLastDevice()
    if (!saved || !saved.deviceId) {
      wx.showToast({ title: '无上次连接记录', icon: 'none' })
      return
    }
    await this._doConnect(saved.deviceId, saved.name)
  },

  async handleConnect(e) {
    const deviceId = e.currentTarget.dataset.deviceid
    const deviceName = e.currentTarget.dataset.devicename || deviceId
    await this._doConnect(deviceId, deviceName)
  },

  async _doConnect(deviceId, deviceName) {
    try {
      wx.showLoading({ title: '连接中...' })
      await this.ble.connect(deviceId)

      app.globalData.connected = true
      app.globalData.connectedDeviceId = deviceId
      app.globalData.connectedDeviceName = deviceName

      storage.setLastDevice({ deviceId, name: deviceName })

      this.setData({
        devices: [],
        showDeviceList: false,
        isConnected: true,
        connectedDeviceName: deviceName,
        connectedDeviceId: deviceId
      })

      wx.hideLoading()
      wx.showToast({ title: '连接成功', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '连接失败', icon: 'none' })
    }
  },

  // ─── 断开 ──────────────────────────────────────

  async handleDisconnect() {
    try {
      await this.ble.disconnect()
      app.globalData.connected = false
      app.globalData.connectedDeviceId = ''
      app.globalData.connectedDeviceName = ''

      this.setData({
        isConnected: false,
        connectedDeviceName: '',
        connectedDeviceId: '',
        devices: [],
        rssi: null
      })
      wx.showToast({ title: '已断开', icon: 'none' })
    } catch (e) {
      wx.showToast({ title: '断开失败', icon: 'none' })
    }
  },

  // ─── 模式 ──────────────────────────────────────

  handleModeChange(e) {
    const modeIndex = Number(e.detail.value)
    this.setData({ modeIndex })
    app.globalData.currentMode = this.data.modeOptions[modeIndex].value
  },

  // ─── 导航 ──────────────────────────────────────

  goTerminal() {
    if (!app.globalData.connected) {
      wx.showToast({ title: '请先连接设备', icon: 'none' })
      return
    }
    wx.switchTab({ url: '/pages/terminal/terminal' })
  }
})
