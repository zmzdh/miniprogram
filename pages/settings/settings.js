/**
 * 设置页
 */

const storage = require('../../services/storage')
const { SERVICE_PRESETS } = require('../../utils/ble-manager')
const { BAUD_RATE_PRESETS, CHECK_TYPE } = require('../../utils/lin-protocol')

Page({
  data: {
    // BLE 设置
    scanTimeout: 10,
    connectTimeout: 10,
    autoReconnect: false,
    maxReconnectAttempts: 3,

    // 蓝牙服务预设
    blePresetIndex: 0,
    blePresets: [
      { label: 'HC-08/HM-10 (FFE0)', key: 'HC-08/HM-10' },
      { label: 'CH340 BLE', key: 'CH340 BLE' }
    ],

    // 自定义 BLE UUID
    showCustomUUID: false,
    customServiceId: '',
    customWriteId: '',
    customNotifyId: '',

    // 协议默认值
    defaultBaudRate: 19200,
    defaultCheckType: 2,
    defaultMode: 1,
    periodicInterval: 500,

    // 波特率选项
    baudRateOptions: [
      { label: '20000 bps', value: 20000 },
      { label: '19200 bps', value: 19200 },
      { label: '10400 bps', value: 10400 },
      { label: '9600 bps',  value: 9600 },
      { label: '4800 bps',  value: 4800 }
    ],
    baudRateIndex: 1,

    // 校验默认
    checkTypeOptions: [
      { label: '无校验', value: CHECK_TYPE.NONE },
      { label: '经典(V1.x)', value: CHECK_TYPE.CLASSIC },
      { label: '增强(V2.x)', value: CHECK_TYPE.ENHANCED }
    ],
    checkTypeIndex: 2,

    // 默认模式
    modeOptions: [
      { label: '监听模式', value: 0 },
      { label: '主模式', value: 1 },
      { label: '从机模式', value: 2 },
      { label: '嗅探模式', value: 3 }
    ],
    modeIndex: 1,

    // 周期
    periodOptions: [
      { label: '50ms', value: 50 },
      { label: '100ms', value: 100 },
      { label: '200ms', value: 200 },
      { label: '500ms', value: 500 },
      { label: '1000ms', value: 1000 }
    ],
    periodIndex: 3,

    // 已保存的设备配置
    profileCount: 0,

    // 关于
    appVersion: '2.0.0',
    sdkVersion: ''
  },

  onLoad() {
    const s = storage.getSettings()
    const svcCfg = storage.getBLEServiceConfig()

    // 确定BLE预设
    let blePresetIndex = 0
    if (svcCfg) {
      const idx = this.data.blePresets.findIndex(p => {
        const preset = SERVICE_PRESETS[p.key]
        return preset && svcCfg.serviceId === preset.serviceId
      })
      if (idx >= 0) {
        blePresetIndex = idx
      } else {
        this.setData({
          showCustomUUID: true,
          customServiceId: svcCfg.serviceId,
          customWriteId: svcCfg.writeId,
          customNotifyId: svcCfg.notifyId
        })
      }
    }

    // 波特率
    let baudIdx = 1
    const baudKeys = Object.keys(BAUD_RATE_PRESETS).map(Number)
    const baudVal = s.defaultBaudRate || 19200
    const foundBaud = baudKeys.indexOf(baudVal)
    if (foundBaud >= 0) baudIdx = foundBaud

    // 校验类型
    let ctIdx = 2
    if (s.defaultCheckType === CHECK_TYPE.NONE) ctIdx = 0
    else if (s.defaultCheckType === CHECK_TYPE.CLASSIC) ctIdx = 1

    // 默认模式
    let modeIdx = s.defaultMode || 1
    if (modeIdx < 0 || modeIdx > 3) modeIdx = 1

    // 周期索引
    let periodIdx = 3
    const periodVals = [50, 100, 200, 500, 1000]
    const foundP = periodVals.indexOf(s.periodicInterval || 500)
    if (foundP >= 0) periodIdx = foundP

    this.setData({
      scanTimeout: (s.scanTimeout || 10000) / 1000,
      connectTimeout: (s.connectTimeout || 10000) / 1000,
      autoReconnect: s.autoReconnect || false,
      maxReconnectAttempts: s.maxReconnectAttempts || 3,
      blePresetIndex,
      baudRateIndex: baudIdx,
      checkTypeIndex: ctIdx,
      modeIndex: modeIdx,
      periodIndex: periodIdx,
      profileCount: storage.getDeviceProfiles().length
    })

    // SDK版本
    try {
      const sysInfo = wx.getSystemInfoSync()
      this.setData({ sdkVersion: sysInfo.SDKVersion || '未知' })
    } catch (_) {}
  },

  onShow() {
    this.setData({ profileCount: storage.getDeviceProfiles().length })
  },

  // ─── 表单事件 ──────────────────────────────────

  onScanTimeout(e) { this.setData({ scanTimeout: Number(e.detail.value) || 10 }) },
  onConnectTimeout(e) { this.setData({ connectTimeout: Number(e.detail.value) || 10 }) },
  onMaxReconnect(e) { this.setData({ maxReconnectAttempts: Number(e.detail.value) || 3 }) },
  onAutoReconnect(e) { this.setData({ autoReconnect: e.detail.value }) },

  handleBlePresetChange(e) {
    const idx = Number(e.detail.value)
    this.setData({ blePresetIndex: idx })
    if (idx === this.data.blePresets.length) {
      // 自定义
      this.setData({ showCustomUUID: true })
    }
  },

  onCustomServiceId(e) { this.setData({ customServiceId: e.detail.value }) },
  onCustomWriteId(e) { this.setData({ customWriteId: e.detail.value }) },
  onCustomNotifyId(e) { this.setData({ customNotifyId: e.detail.value }) },

  onBaudRate(e) { this.setData({ baudRateIndex: Number(e.detail.value) }) },
  onCheckType(e) { this.setData({ checkTypeIndex: Number(e.detail.value) }) },
  onMode(e) { this.setData({ modeIndex: Number(e.detail.value) }) },
  onPeriod(e) { this.setData({ periodIndex: Number(e.detail.value) }) },

  // ─── 保存 ──────────────────────────────────────

  handleSave() {
    // 保存BLE服务配置
    if (this.data.showCustomUUID) {
      storage.setBLEServiceConfig({
        serviceId: this.data.customServiceId,
        writeId: this.data.customWriteId,
        notifyId: this.data.customNotifyId
      })
    } else {
      const preset = this.data.blePresets[this.data.blePresetIndex]
      if (preset && preset.key) {
        storage.setBLEServiceConfig(SERVICE_PRESETS[preset.key])
      }
    }

    // 保存通用设置
    storage.setSettings({
      scanTimeout: (this.data.scanTimeout || 10) * 1000,
      connectTimeout: (this.data.connectTimeout || 10) * 1000,
      autoReconnect: this.data.autoReconnect,
      maxReconnectAttempts: this.data.maxReconnectAttempts,
      defaultBaudRate: this.data.baudRateOptions[this.data.baudRateIndex].value,
      defaultCheckType: this.data.checkTypeOptions[this.data.checkTypeIndex].value,
      defaultMode: this.data.modeOptions[this.data.modeIndex].value,
      periodicInterval: this.data.periodOptions[this.data.periodIndex].value
    })

    wx.showToast({ title: '设置已保存', icon: 'success' })
  },

  // ─── 重置 ──────────────────────────────────────

  handleReset() {
    wx.showModal({
      title: '恢复默认',
      content: '确定恢复所有设置为默认值？',
      success: (res) => {
        if (res.confirm) {
          storage.setSettings({})
          storage.setBLEServiceConfig(null)
          this.onLoad()
          wx.showToast({ title: '已恢复', icon: 'success' })
        }
      }
    })
  },

  // ─── 清除所有数据 ──────────────────────────────

  handleClearAll() {
    wx.showModal({
      title: '清除所有数据',
      content: '确定清除所有帧历史、日志和设备配置？此操作不可撤销。',
      success: (res) => {
        if (res.confirm) {
          storage.clearFrameHistory()
          storage.clearLogs()
          storage.setDeviceProfiles([])
          storage.clearLastDevice()
          this.onLoad()
          wx.showToast({ title: '已清除', icon: 'success' })
        }
      }
    })
  }
})
