const BleManager = require('../../utils/ble-manager')
const { buildPacket, bytesToHex } = require('../../utils/lin-protocol')

Page({
  data: {
    devices: [],
    logs: [],
    statusText: '未连接',
    receivedHex: '',
    lastSendHex: '',
    frameIdHex: '12',
    dataHex: '11 22 33 44',
    dataLength: '4',
    directionIndex: 0,
    directionOptions: [
      { label: '发送', value: 'send' },
      { label: '读取', value: 'read' }
    ]
  },

  onLoad() {
    this.ble = new BleManager({
      onLog: (msg) => this.appendLog(msg),
      onDeviceFound: (device) => this.handleDeviceFound(device),
      onStatusChange: (state, msg) => this.handleStatusChange(state, msg),
      onReceiveData: (bytes) => this.handleReceiveData(bytes),
      onSendNum: (num) => this.appendLog(`已发送 ${num} 字节`)
    })
  },

  appendLog(msg) {
    const now = new Date()
    const ts = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
    const line = `[${ts}] ${msg}`

    const logs = this.data.logs.slice()
    logs.unshift(line)
    this.setData({ logs: logs.slice(0, 200) })
  },

  handleDeviceFound(device) {
    const devices = this.data.devices.slice()
    const idx = devices.findIndex(d => d.deviceId === device.deviceId)
    if (idx < 0) {
      devices.push(device)
    } else {
      devices[idx] = device
    }
    this.setData({ devices })
  },

  handleStatusChange(state, msg) {
    const map = {
      scanning: '扫描中',
      scanned: '扫描结束',
      connecting: '连接中',
      connected: '已连接',
      disconnected: '已断开',
      error: '错误'
    }

    const text = msg ? `${map[state] || state} - ${msg}` : (map[state] || state)
    this.setData({ statusText: text })
  },

  handleReceiveData(bytes) {
    const hex = bytesToHex(bytes)
    this.setData({ receivedHex: hex })
    this.appendLog(`收到数据: ${hex}`)
  },

  async handleScan() {
    try {
      this.setData({ devices: [] })
      await this.ble.openAdapter()
      await this.ble.startScan()
      setTimeout(() => {
        this.ble.stopScan()
      }, 10000)
    } catch (err) {
      this.appendLog(`扫描失败: ${err.errMsg || err.message || JSON.stringify(err)}`)
    }
  },

  async handleStopScan() {
    try {
      await this.ble.stopScan()
    } catch (err) {
      this.appendLog(`停止扫描失败: ${err.errMsg || err.message || JSON.stringify(err)}`)
    }
  },

  async handleConnect(e) {
    const deviceId = e.currentTarget.dataset.deviceid
    if (!deviceId) return

    try {
      await this.ble.connect(deviceId)
    } catch (err) {
      this.appendLog(`连接失败: ${err.errMsg || err.message || JSON.stringify(err)}`)
      this.setData({ statusText: '连接失败' })
    }
  },

  async handleDisconnect() {
    try {
      await this.ble.disconnect()
    } catch (err) {
      this.appendLog(`断开失败: ${err.errMsg || err.message || JSON.stringify(err)}`)
    }
  },

  onFrameIdInput(e) {
    this.setData({ frameIdHex: e.detail.value })
  },

  onDataHexInput(e) {
    this.setData({ dataHex: e.detail.value })
  },

  onDataLengthInput(e) {
    this.setData({ dataLength: e.detail.value })
  },

  handleDirectionChange(e) {
    this.setData({ directionIndex: Number(e.detail.value) })
  },

  handleSendLin() {
    try {
      const direction = this.data.directionOptions[this.data.directionIndex].value
      const packet = buildPacket({
        frameIdHex: this.data.frameIdHex,
        dataHex: this.data.dataHex,
        dataLength: Number(this.data.dataLength),
        direction
      })

      const hex = bytesToHex(packet)
      this.setData({ lastSendHex: hex })
      this.appendLog(`发送数据: ${hex}`)

      this.ble.sendBytes(packet)
    } catch (err) {
      wx.showToast({
        title: err.message || '发送失败',
        icon: 'none'
      })
      this.appendLog(`发送失败: ${err.message || JSON.stringify(err)}`)
    }
  }
})