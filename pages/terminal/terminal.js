/**
 * 终端页 - LIN 命令收发控制
 */

const app = getApp()
const storage = require('../../services/storage')
const {
  buildPacket, buildModeConfig, buildSlaveSend, buildSlaveEnable,
  CMD, MODE, CHECK_TYPE
} = require('../../utils/lin-protocol')

Page({
  data: {
    // 连接
    isConnected: false,
    connectedName: '',

    // 模式标签
    modeTabIndex: 1,  // 0=监听 1=主模式 2=从机 3=嗅探
    modeTabs: [
      { label: '监听', mode: MODE.MONITOR },
      { label: '主模式', mode: MODE.MASTER },
      { label: '从机', mode: MODE.SLAVE },
      { label: '嗅探', mode: MODE.SNIFFER }
    ],

    // 主模式参数
    frameIdHex: '12',
    dataHex: '11 22 33 44',
    dataLength: '4',
    directionIndex: 0,
    directionOptions: [
      { label: '发送', value: 'send' },
      { label: '读取', value: 'read' }
    ],

    // 校验类型
    checkTypeIndex: 2,
    checkTypeOptions: [
      { label: '无校验', value: CHECK_TYPE.NONE },
      { label: '经典(V1.x)', value: CHECK_TYPE.CLASSIC },
      { label: '增强(V2.x)', value: CHECK_TYPE.ENHANCED }
    ],

    // 波特率
    baudRateIndex: 1,
    baudRateOptions: [
      { label: '20000 bps', value: 20000 },
      { label: '19200 bps', value: 19200 },
      { label: '10400 bps', value: 10400 },
      { label: '9600 bps',  value: 9600 },
      { label: '4800 bps',  value: 4800 }
    ],

    // 从机模式
    slaveChannel: 0,
    slaveDirIndex: 1,
    slaveDirOptions: [
      { label: '从机接收', value: 0 },
      { label: '从机发送', value: 1 }
    ],

    // 周期发送
    periodIndex: 2,
    periodOptions: [
      { label: '50ms',  value: 50 },
      { label: '100ms', value: 100 },
      { label: '200ms', value: 200 },
      { label: '500ms', value: 500 },
      { label: '1000ms',value: 1000 },
      { label: '2000ms',value: 2000 }
    ],
    isPeriodic: false,

    // 命令模板
    profiles: storage.getDeviceProfiles(),
    profileIndex: 0,
    commandGroups: [],

    // 显示
    lastFrame: null,
    frameHistory: [],

    // 帧数统计
    cntPrefix: '帧数统计',
    sendCount: 0,
    recvCount: 0,
  },

  onLoad() {
    this.ble = app.globalData.bleManager
    this.periodTimer = null
    this.sendCount = 0
    this.recvCount = 0
    this._updateProfiles()
  },

  onShow() {
    const g = app.globalData
    this.setData({
      isConnected: g.connected,
      connectedName: g.connectedDeviceName,
      frameHistory: g.frameHistory.slice(0, 50),
      sendCount: this.sendCount,
      recvCount: this.recvCount
    })
    this._updateProfiles()
  },

  onUnload() {
    this._stopPeriodic()
  },

  // ─── 全局事件 ──────────────────────────────────

  onBleStatusChange(data) {
    this.setData({ isConnected: data.isConnected })
  },

  onBleReceiveData(data) {
    this.recvCount++
    this.setData({
      lastFrame: data.parsed,
      frameHistory: (data.frameHistory || []).slice(0, 50),
      recvCount: this.recvCount
    })
  },

  onBleSendNum(data) {
    // 发送计数
  },

  // ─── 模式切换 ──────────────────────────────────

  handleModeTab(e) {
    const idx = Number(e.currentTarget.dataset.index)
    this.setData({ modeTabIndex: idx })
    app.globalData.currentMode = this.data.modeTabs[idx].mode
    // 非主模式时停止周期发送
    if (idx !== 1) {
      this._stopPeriodic()
    }
  },

  // ─── 参数输入 ──────────────────────────────────

  onFrameIdInput(e) { this.setData({ frameIdHex: e.detail.value }) },
  onDataHexInput(e) { this.setData({ dataHex: e.detail.value }) },
  onDataLenInput(e) { this.setData({ dataLength: e.detail.value }) },

  handleDirChange(e) {
    this.setData({ directionIndex: Number(e.detail.value) })
  },

  handleCheckTypeChange(e) {
    this.setData({ checkTypeIndex: Number(e.detail.value) })
  },

  handleBaudRateChange(e) {
    this.setData({ baudRateIndex: Number(e.detail.value) })
  },

  handlePeriodChange(e) {
    this.setData({ periodIndex: Number(e.detail.value) })
  },

  onSlaveChannelInput(e) {
    const v = parseInt(e.detail.value) || 0
    this.setData({ slaveChannel: Math.min(15, Math.max(0, v)) })
  },

  handleSlaveDirChange(e) {
    this.setData({ slaveDirIndex: Number(e.detail.value) })
  },

  // ─── 发送 ──────────────────────────────────────

  /**
   * 发送模式配置命令 (切换LINTest-M工作模式)
   */
  async handleSetMode() {
    if (!this._checkConnected()) return

    const mode = this.data.modeTabs[this.data.modeTabIndex].mode
    const baudRate = this.data.baudRateOptions[this.data.baudRateIndex].value

    try {
      const frame = buildModeConfig(mode, baudRate)
      const { wrapForBLE } = require('../../utils/lin-protocol')
      const bytes = wrapForBLE(frame)

      this.ble.sendBytes(bytes)
      this._log('设置模式: ' + this.data.modeTabs[this.data.modeTabIndex].label +
        ' 波特率: ' + baudRate)
      wx.showToast({ title: '模式已设置', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '设置失败: ' + e.message, icon: 'none' })
    }
  },

  /**
   * 发送/读取 LIN 命令
   */
  handleSend(isPeriodic = false) {
    if (!this._checkConnected()) return
    // isPeriodic 必须严格为 true 才走周期校验，避免 bindtap 传入的 event 对象被当作 truthy
    if (isPeriodic === true && !this.data.isPeriodic) return

    try {
      const mode = this.data.modeTabs[this.data.modeTabIndex].mode
      const dir = this.data.directionOptions[this.data.directionIndex].value
      const ct = this.data.checkTypeOptions[this.data.checkTypeIndex].value

      const cfg = {
        frameIdHex: this.data.frameIdHex,
        dataHex: this.data.dataHex,
        dataLength: Number(this.data.dataLength),
        direction: dir,
        checkType: ct,
        mode: mode
      }

      // 从机模式特殊处理
      if (mode === MODE.SLAVE) {
        cfg.cmd = CMD.SLAVE_SEND
        cfg.channel = this.data.slaveChannel
        cfg.dir = this.data.slaveDirOptions[this.data.slaveDirIndex].value
      }

      const packet = buildPacket(cfg)
      const { wrapForBLE } = require('../../utils/lin-protocol')
      const bytes = wrapForBLE(packet)

      this.ble.sendBytes(bytes)
      this.sendCount++
      this.setData({
        sendCount: this.sendCount
      })

      if (!isPeriodic) {
        this._log('发送: ID=' + cfg.frameIdHex + ' LEN=' + cfg.dataLength)
        // 添加到帧历史
        const history = [...this.data.frameHistory]
        history.unshift({
          time: this._nowTime(),
          direction: 'send',
          dirName: '发送',
          linIdHex: cfg.frameIdHex.toUpperCase(),
          dataLen: cfg.dataLength,
          dataHex: cfg.dataHex || ''
        })
        this.setData({ frameHistory: history.slice(0, 50) })
      }

      return true
    } catch (e) {
      if (!isPeriodic) {
        wx.showToast({ title: '发送失败: ' + e.message, icon: 'none' })
        this._log('发送失败: ' + e.message)
      }
      return false
    }
  },

  // ─── 周期发送 ──────────────────────────────────

  togglePeriodic() {
    if (this.data.isPeriodic) {
      this._stopPeriodic()
    } else {
      this._startPeriodic()
    }
  },

  _startPeriodic() {
    this._stopPeriodic()
    const interval = this.data.periodOptions[this.data.periodIndex].value
    this.setData({ isPeriodic: true })
    this._log('周期发送开始 (间隔=' + interval + 'ms)')

    this.periodTimer = setInterval(() => {
      this.handleSend(true)
    }, interval)
  },

  _stopPeriodic() {
    if (this.periodTimer) {
      clearInterval(this.periodTimer)
      this.periodTimer = null
    }
    if (this.data.isPeriodic) {
      this.setData({ isPeriodic: false })
      this._log('周期发送停止')
    }
  },

  // ─── 从机通道使能 ──────────────────────────────

  async handleSlaveEnable() {
    if (!this._checkConnected()) return
    try {
      const frame = buildSlaveEnable(this.data.slaveChannel, true)
      const { wrapForBLE } = require('../../utils/lin-protocol')
      this.ble.sendBytes(wrapForBLE(frame))
      this._log('使能从机通道: ' + this.data.slaveChannel)
      wx.showToast({ title: '通道' + this.data.slaveChannel + '已使能', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  async handleSlaveDisable() {
    if (!this._checkConnected()) return
    try {
      const frame = buildSlaveEnable(this.data.slaveChannel, false)
      const { wrapForBLE } = require('../../utils/lin-protocol')
      this.ble.sendBytes(wrapForBLE(frame))
      this._log('禁能从机通道: ' + this.data.slaveChannel)
      wx.showToast({ title: '通道' + this.data.slaveChannel + '已禁止', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // ─── 命令模板 ──────────────────────────────────

  _updateProfiles() {
    const profiles = storage.getDeviceProfiles()
    const profile = profiles[this.data.profileIndex]
    this.setData({
      profiles,
      commandGroups: profile ? profile.groups || [] : []
    })
  },

  handleProfileChange(e) {
    this.setData({ profileIndex: Number(e.detail.value) })
    this._updateProfiles()
  },

  findCommandById(cmdId) {
    for (const group of this.data.commandGroups) {
      for (const cmd of group.commands) {
        if (cmd.id === cmdId) return cmd
      }
    }
    return null
  },

  handleCommandTap(e) {
    const cmd = this.findCommandById(e.currentTarget.dataset.commandid)
    if (!cmd) return
    const dirIdx = this.data.directionOptions.findIndex(d => d.value === cmd.direction)
    this.setData({
      frameIdHex: cmd.frameIdHex,
      dataHex: cmd.dataHex || '',
      dataLength: String(cmd.dataLength),
      directionIndex: dirIdx >= 0 ? dirIdx : 0
    })
    this._log('加载命令: ' + cmd.name)
  },

  handleQuickSend(e) {
    const cmd = this.findCommandById(e.currentTarget.dataset.commandid)
    if (!cmd) return
    const dirIdx = this.data.directionOptions.findIndex(d => d.value === cmd.direction)
    this.setData({
      frameIdHex: cmd.frameIdHex,
      dataHex: cmd.dataHex || '',
      dataLength: String(cmd.dataLength),
      directionIndex: dirIdx >= 0 ? dirIdx : 0
    })
    setTimeout(() => this.handleSend(), 80)
  },

  // ─── 清空 ──────────────────────────────────────

  clearFrames() {
    storage.clearFrameHistory()
    this.setData({ frameHistory: [], lastFrame: null })
    this.sendCount = 0
    this.recvCount = 0
  },

  // ─── 工具 ──────────────────────────────────────

  _checkConnected() {
    if (!app.globalData.connected) {
      wx.showToast({ title: '请先连接设备', icon: 'none' })
      return false
    }
    return true
  },

  _log(msg) {
    const logs = [...(this.data.logs || [])]
    logs.unshift('[' + this._nowTime() + '] ' + msg)
    this.setData({ logs: logs.slice(0, 100) })
    storage.addLog(msg)
  },

  _nowTime() {
    const now = new Date()
    return [
      now.getHours().toString().padStart(2, '0'),
      now.getMinutes().toString().padStart(2, '0'),
      now.getSeconds().toString().padStart(2, '0')
    ].join(':')
  }
})
