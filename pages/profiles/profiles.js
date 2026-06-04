/**
 * 配置页 - 设备 Profile 管理
 */

const storage = require('../../services/storage')
const { parseLDF } = require('../../utils/ldf-parser')

Page({
  data: {
    profiles: [],
    selectedProfileId: '',
    selectedProfile: null,

    // 添加/编辑表单
    showEditor: false,
    editMode: 'add',  // 'add' | 'edit'
    editProfileId: '',
    formName: '',
    formDesc: '',

    // 分组编辑
    groups: [],
    showGroupEditor: false,
    editGroupId: '',
    groupFormName: '',

    // 命令编辑
    showCmdEditor: false,
    editCmdId: '',
    cmdFormGroupId: '',
    cmdFormName: '',
    cmdFormDesc: '',
    cmdFormDirection: 'send',
    cmdFormFrameIdHex: '12',
    cmdFormDataHex: '',
    cmdFormDataLength: '4'
  },

  onShow() {
    this.loadProfiles()
  },

  loadProfiles() {
    const profiles = storage.getDeviceProfiles()
    this.setData({ profiles })
    if (this.data.selectedProfileId) {
      const p = profiles.find(x => x.id === this.data.selectedProfileId)
      this.setData({ selectedProfile: p || null })
    }
  },

  // ─── Profile CRUD ──────────────────────────────

  selectProfile(e) {
    const id = e.currentTarget.dataset.id
    const profile = this.data.profiles.find(p => p.id === id)
    this.setData({ selectedProfileId: id, selectedProfile: profile })
  },

  showAddProfile() {
    this.setData({
      showEditor: true,
      editMode: 'add',
      editProfileId: '',
      formName: '',
      formDesc: ''
    })
  },

  showEditProfile(e) {
    const id = e.currentTarget.dataset.id
    const profile = this.data.profiles.find(p => p.id === id)
    if (!profile) return
    this.setData({
      showEditor: true,
      editMode: 'edit',
      editProfileId: id,
      formName: profile.name,
      formDesc: profile.description || ''
    })
  },

  saveProfile() {
    const { editMode, editProfileId, formName, formDesc } = this.data
    if (!formName.trim()) {
      wx.showToast({ title: '请输入名称', icon: 'none' })
      return
    }

    if (editMode === 'add') {
      storage.addDeviceProfile({
        name: formName.trim(),
        description: formDesc.trim(),
        groups: []
      })
    } else {
      storage.updateDeviceProfile(editProfileId, {
        name: formName.trim(),
        description: formDesc.trim()
      })
    }

    this.setData({ showEditor: false })
    this.loadProfiles()
    wx.showToast({ title: '保存成功', icon: 'success' })
  },

  deleteProfile(e) {
    const id = e.currentTarget.dataset.id
    const profile = this.data.profiles.find(p => p.id === id)
    if (!profile) return

    wx.showModal({
      title: '确认删除',
      content: '确定删除「' + profile.name + '」及所有命令？',
      success: (res) => {
        if (res.confirm) {
          storage.deleteDeviceProfile(id)
          if (this.data.selectedProfileId === id) {
            this.setData({ selectedProfileId: '', selectedProfile: null })
          }
          this.loadProfiles()
          wx.showToast({ title: '已删除', icon: 'success' })
        }
      }
    })
  },

  // ─── Group CRUD ────────────────────────────────

  showAddGroup() {
    this.setData({
      showGroupEditor: true,
      editGroupId: '',
      groupFormName: ''
    })
  },

  saveGroup() {
    const name = this.data.groupFormName.trim()
    if (!name) {
      wx.showToast({ title: '请输入分组名', icon: 'none' })
      return
    }

    const profile = this.data.selectedProfile
    if (!profile) return

    const groups = [...(profile.groups || [])]
    if (this.data.editGroupId) {
      const idx = groups.findIndex(g => g.id === this.data.editGroupId)
      if (idx >= 0) groups[idx].name = name
    } else {
      groups.push({ id: 'g_' + Date.now(), name, commands: [] })
    }

    storage.updateDeviceProfile(profile.id, { groups })
    this.setData({ showGroupEditor: false })
    this.loadProfiles()
  },

  deleteGroup(e) {
    const groupId = e.currentTarget.dataset.groupid
    const profile = this.data.selectedProfile
    if (!profile) return

    wx.showModal({
      title: '确认删除',
      content: '确定删除该分组及所有命令？',
      success: (res) => {
        if (res.confirm) {
          const groups = profile.groups.filter(g => g.id !== groupId)
          storage.updateDeviceProfile(profile.id, { groups })
          this.loadProfiles()
        }
      }
    })
  },

  // ─── Command CRUD ──────────────────────────────

  showAddCmd(e) {
    const groupId = e.currentTarget.dataset.groupid
    this.setData({
      showCmdEditor: true,
      editCmdId: '',
      cmdFormGroupId: groupId,
      cmdFormName: '',
      cmdFormDesc: '',
      cmdFormDirection: 'send',
      cmdFormFrameIdHex: '12',
      cmdFormDataHex: '',
      cmdFormDataLength: '4'
    })
  },

  editCmd(e) {
    const { cmdid, groupid } = e.currentTarget.dataset
    const profile = this.data.selectedProfile
    if (!profile) return
    for (const g of profile.groups) {
      for (const c of g.commands) {
        if (c.id === cmdid) {
          this.setData({
            showCmdEditor: true,
            editCmdId: cmdid,
            cmdFormGroupId: groupid,
            cmdFormName: c.name,
            cmdFormDesc: c.description || '',
            cmdFormDirection: c.direction || 'send',
            cmdFormFrameIdHex: c.frameIdHex || '12',
            cmdFormDataHex: c.dataHex || '',
            cmdFormDataLength: String(c.dataLength || 4)
          })
          return
        }
      }
    }
  },

  saveCmd() {
    const {
      cmdFormName, cmdFormDesc, cmdFormDirection,
      cmdFormFrameIdHex, cmdFormDataHex, cmdFormDataLength,
      editCmdId, cmdFormGroupId
    } = this.data

    if (!cmdFormName.trim()) {
      wx.showToast({ title: '请输入命令名', icon: 'none' })
      return
    }

    const len = Number(cmdFormDataLength)
    if (len < 1 || len > 8) {
      wx.showToast({ title: '数据长度1-8', icon: 'none' })
      return
    }

    const profile = this.data.selectedProfile
    if (!profile) return

    const groups = [...profile.groups]
    const gIdx = groups.findIndex(g => g.id === cmdFormGroupId)
    if (gIdx < 0) return

    const cmd = {
      id: editCmdId || ('c_' + Date.now()),
      name: cmdFormName.trim(),
      description: cmdFormDesc.trim(),
      direction: cmdFormDirection,
      frameIdHex: cmdFormFrameIdHex.trim() || '12',
      dataHex: cmdFormDataHex.trim(),
      dataLength: len
    }

    if (editCmdId) {
      const cIdx = groups[gIdx].commands.findIndex(c => c.id === editCmdId)
      if (cIdx >= 0) groups[gIdx].commands[cIdx] = cmd
    } else {
      groups[gIdx].commands.push(cmd)
    }

    storage.updateDeviceProfile(profile.id, { groups })
    this.setData({ showCmdEditor: false })
    this.loadProfiles()
    wx.showToast({ title: '保存成功', icon: 'success' })
  },

  deleteCmd(e) {
    const { cmdid, groupid } = e.currentTarget.dataset
    const profile = this.data.selectedProfile
    if (!profile) return

    wx.showModal({
      title: '确认删除',
      content: '确定删除该命令？',
      success: (res) => {
        if (res.confirm) {
          const groups = [...profile.groups]
          const gIdx = groups.findIndex(g => g.id === groupid)
          if (gIdx >= 0) {
            groups[gIdx].commands = groups[gIdx].commands.filter(c => c.id !== cmdid)
            storage.updateDeviceProfile(profile.id, { groups })
            this.loadProfiles()
          }
        }
      }
    })
  },

  // ─── 表单输入 ──────────────────────────────────

  onFormName(e) { this.setData({ formName: e.detail.value }) },
  onFormDesc(e) { this.setData({ formDesc: e.detail.value }) },
  onGroupFormName(e) { this.setData({ groupFormName: e.detail.value }) },
  onCmdFormName(e) { this.setData({ cmdFormName: e.detail.value }) },
  onCmdFormDesc(e) { this.setData({ cmdFormDesc: e.detail.value }) },
  onCmdFormId(e) { this.setData({ cmdFormFrameIdHex: e.detail.value }) },
  onCmdFormData(e) { this.setData({ cmdFormDataHex: e.detail.value }) },
  onCmdFormLen(e) { this.setData({ cmdFormDataLength: e.detail.value }) },

  handleCmdDirChange(e) {
    this.setData({ cmdFormDirection: e.detail.value === '1' ? 'read' : 'send' })
  },

  // ─── 导入/导出 ─────────────────────────────────

  handleExport() {
    const json = storage.exportProfilesJSON()
    if (!json || json === '[]') {
      wx.showToast({ title: '无数据可导出', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: json,
      success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
    })
  },

  handleImport() {
    wx.showModal({
      title: '导入配置',
      content: '将粘贴板中的JSON配置导入，将覆盖当前所有配置。确认继续？',
      success: (res) => {
        if (!res.confirm) return
        wx.getClipboardData({
          success: (r) => {
            try {
              storage.importProfilesJSON(r.data)
              this.loadProfiles()
              wx.showToast({ title: '导入成功', icon: 'success' })
            } catch (e) {
              wx.showToast({ title: 'JSON格式错误', icon: 'none' })
            }
          },
          fail: () => wx.showToast({ title: '读取剪贴板失败', icon: 'none' })
        })
      }
    })
  },

  // ─── LDF 导入 ───────────────────────────────────

  handleImportLDF() {
    const self = this
    wx.showActionSheet({
      itemList: ['从剪贴板粘贴', '选择聊天文件'],
      success(res) {
        if (res.tapIndex === 0) {
          self._importLDFFromClipboard()
        } else if (res.tapIndex === 1) {
          self._importLDFFromFile()
        }
      }
    })
  },

  _importLDFFromClipboard() {
    const self = this
    wx.getClipboardData({
      success(res) {
        if (!res.data || res.data.trim().length === 0) {
          wx.showToast({ title: '剪贴板为空', icon: 'none' })
          return
        }
        try {
          const result = parseLDF(res.data)
          self._saveLDFResult(result)
        } catch (e) {
          wx.showToast({ title: '解析失败: ' + (e.message || '格式错误'), icon: 'none' })
        }
      },
      fail() {
        wx.showToast({ title: '读取剪贴板失败', icon: 'none' })
      }
    })
  },

  _importLDFFromFile() {
    const self = this
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['ldf', 'LDF', 'txt'],
      success(res) {
        const filePath = res.tempFiles[0].path
        const fs = wx.getFileSystemManager()
        try {
          // LDF 文件通常是 ASCII/UTF-8 编码
          const text = fs.readFileSync(filePath, 'utf-8')
          const result = parseLDF(text)
          self._saveLDFResult(result)
        } catch (e) {
          wx.showToast({ title: '解析失败: ' + (e.message || '格式错误'), icon: 'none' })
        }
      },
      fail(err) {
        if (err.errMsg && err.errMsg.includes('cancel')) return
        wx.showToast({ title: '选择文件失败', icon: 'none' })
      }
    })
  },

  _saveLDFResult(result) {
    storage.addDeviceProfile({
      name: result.name,
      description: result.description,
      groups: result.groups
    })
    this.loadProfiles()
    const cmdCount = result.groups.reduce((sum, g) => sum + g.commands.length, 0)
    wx.showToast({
      title: '导入成功: ' + result.groups.length + '组 ' + cmdCount + '条命令',
      icon: 'success',
      duration: 2000
    })
  },

  // ─── 关闭弹窗 ──────────────────────────────────

  noop() {},
  closeEditor() { this.setData({ showEditor: false }) },
  closeGroupEditor() { this.setData({ showGroupEditor: false }) },
  closeCmdEditor() { this.setData({ showCmdEditor: false }) }
})
