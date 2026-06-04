/**
 * 日志页 - 帧历史浏览与导出
 */

const storage = require('../../services/storage')

Page({
  data: {
    logs: [],
    frameHistory: [],
    activeTab: 0,  // 0=帧历史, 1=系统日志
    filterDirection: 'all',
    filterFrameId: ''
  },

  onShow() {
    this.loadData()
  },

  loadData() {
    this.setData({
      frameHistory: storage.getFrameHistory(),
      logs: storage.getLogs()
    })
  },

  switchTab(e) {
    this.setData({ activeTab: Number(e.currentTarget.dataset.tab) })
  },

  handleFilterDir(e) {
    this.setData({ filterDirection: e.currentTarget.dataset.dir || 'all' })
  },

  onFilterIdInput(e) {
    this.setData({ filterFrameId: e.detail.value.toUpperCase() })
  },

  getFilteredFrames() {
    let frames = this.data.frameHistory
    if (this.data.filterDirection !== 'all') {
      frames = frames.filter(f => f.direction === this.data.filterDirection)
    }
    if (this.data.filterFrameId) {
      frames = frames.filter(f => {
        const idHex = (f.linIdHex || f.frameIdHex || '').toUpperCase()
        return idHex.includes(this.data.filterFrameId)
      })
    }
    return frames
  },

  handleExportCSV() {
    const csv = storage.exportFrameHistoryCSV()
    if (!csv) {
      wx.showToast({ title: '无数据可导出', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: csv,
      success: () => wx.showToast({ title: 'CSV已复制到剪贴板', icon: 'success' })
    })
  },

  handleExportJSON() {
    const json = storage.exportFrameHistoryJSON()
    if (!json || json === '[]') {
      wx.showToast({ title: '无数据可导出', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: json,
      success: () => wx.showToast({ title: 'JSON已复制到剪贴板', icon: 'success' })
    })
  },

  handleClearFrames() {
    wx.showModal({
      title: '确认清空',
      content: '确定清空所有帧历史？',
      success: (res) => {
        if (res.confirm) {
          storage.clearFrameHistory()
          this.loadData()
          wx.showToast({ title: '已清空', icon: 'success' })
        }
      }
    })
  },

  handleClearLogs() {
    wx.showModal({
      title: '确认清空',
      content: '确定清空所有系统日志？',
      success: (res) => {
        if (res.confirm) {
          storage.clearLogs()
          this.loadData()
          wx.showToast({ title: '已清空', icon: 'success' })
        }
      }
    })
  },

  viewFrameDetail(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const frames = this.getFilteredFrames()
    const frame = frames[idx]
    if (!frame) return

    const lines = []
    if (frame.time) lines.push('时间: ' + frame.time)
    lines.push('方向: ' + (frame.direction || '未知'))
    if (frame.linIdHex) lines.push('ID: 0x' + frame.linIdHex)
    if (frame.pidHex) lines.push('PID: 0x' + frame.pidHex)
    if (frame.dataLen) lines.push('长度: ' + frame.dataLen)
    if (frame.dataHex) lines.push('数据: ' + frame.dataHex)
    if (frame.linCheckHex) lines.push('LIN校验: 0x' + frame.linCheckHex)
    if (frame.frameCRCHex) lines.push('帧CRC: 0x' + frame.frameCRCHex)
    if (frame.rawHex) lines.push('原始: ' + frame.rawHex)
    if (frame.crcValid !== undefined) lines.push('CRC: ' + (frame.crcValid ? '有效' : '无效'))

    wx.showModal({
      title: '帧详情',
      content: lines.join('\n'),
      showCancel: false
    })
  }
})
