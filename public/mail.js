/* ========================================
   邮箱系统 - JavaScript
   极简主义交互设计
======================================== */

;(function () {
  'use strict'

  const CONFIG = {
    STORAGE_KEY: 'emailData',
    PASSWORD_KEY: 'password',
    MAIL_ITEMS_PER_PAGE: 10,
    DEFAULT_ITEMS_PER_PAGE: 10,
    API_BASE: '/api/mail-all',
    REFRESH_TOKEN_API: '/api/refresh-token'
  }

  const AUTH_ERROR_MESSAGE = '密码验证失败，请输入正确验证密码'


  const state = {
    emailData: [],
    mailData: [],
    currentPage: 1,
    currentMailPage: 1,
    itemsPerPage: CONFIG.DEFAULT_ITEMS_PER_PAGE,
    selectedItems: [],
    searchKeyword: ''
  }

  const $ = (sel, ctx = document) => ctx.querySelector(sel)
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)]

  /* ---------- Loading ---------- */
  const showLoading = () => $('#loading-overlay').style.display = 'flex'
  const hideLoading = () => $('#loading-overlay').style.display = 'none'

  /* ---------- 模态框 ---------- */
  const openModal = (id) => $(`#${id}`).style.display = 'flex'
  const closeModal = (id) => $(`#${id}`).style.display = 'none'
  const closeAllModals = () => $$('.modal-overlay').forEach(el => el.style.display = 'none')

  /* ---------- localStorage ---------- */
  const getEmailData = () => JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)) || []
  const setEmailData = (data) => localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data))
  const getPassword = () => localStorage.getItem(CONFIG.PASSWORD_KEY) || ''
  const setPassword = (pwd) => localStorage.setItem(CONFIG.PASSWORD_KEY, pwd)

  /* ---------- 工具函数 ---------- */
  const showToast = (message) => {
    const toast = $('#toast')
    if (!toast) return
    toast.textContent = message
    toast.style.display = 'block'
    setTimeout(() => toast.style.display = 'none', 2000)
  }

  /* ---------- 账号列表相关 ---------- */
  const getFilteredData = () => {
    const data = getEmailData()
    const indexedData = data.map((item, index) => ({ ...item, index }))
    if (!state.searchKeyword) return indexedData
    const kw = state.searchKeyword.toLowerCase()
    return indexedData.filter(item =>
      item.email.toLowerCase().includes(kw)
    )
  }

  const renderTable = () => {
    const tbody = $('#email-table tbody')
    const filtered = getFilteredData()
    const start = (state.currentPage - 1) * state.itemsPerPage
    const end = start + state.itemsPerPage
    const pageData = filtered.slice(start, end)

    const formatRefreshToken = (token) => {
      if (!token || token.length <= 16) return token || ''
      return `${token.slice(0, 6)}...${token.slice(-10)}`
    }

    if (pageData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">暂无数据</td></tr>`
      updateSelectAllState()
      return
    }

    tbody.innerHTML = pageData.map((item) => {
      return `
        <tr data-index="${item.index}">
          <td class="check-col">
            <input type="checkbox" data-index="${item.index}" ${state.selectedItems.includes(String(item.index)) ? 'checked' : ''}>
          </td>
          <td class="text-ellipsis" title="${item.email}">${item.email}</td>
          <td class="text-ellipsis" title="${item.clientId}">${item.clientId}</td>
          <td class="refresh-token" title="${item.refreshToken}">${formatRefreshToken(item.refreshToken)}</td>
          <td>
            <div class="actions">
              <button class="btn btn-sm" data-action="inbox">收件箱</button>
              <button class="btn btn-sm" data-action="junk">垃圾箱</button>
              <button class="btn btn-sm btn-danger" data-action="delete">删除</button>
            </div>
          </td>
        </tr>
      `
    }).join('')

    updateSelectAllState()
  }

  const updateSelectAllState = () => {
    const selectAll = $('#select-all')
    if (!selectAll) return

    const filteredIndexes = getFilteredData().map(item => String(item.index))
    const selectedCount = filteredIndexes.filter(index => state.selectedItems.includes(index)).length

    selectAll.checked = filteredIndexes.length > 0 && selectedCount === filteredIndexes.length
    selectAll.indeterminate = selectedCount > 0 && selectedCount < filteredIndexes.length
  }

  const renderPagination = () => {
    const filtered = getFilteredData()
    const total = filtered.length
    const totalPages = Math.ceil(total / state.itemsPerPage)
    const info = $('#pagination-info')
    const btns = $('#pagination-btns')

    info.textContent = `共 ${total} 条`

    if (totalPages <= 1) {
      btns.innerHTML = ''
      return
    }

    let html = `<button ${state.currentPage <= 1 ? 'disabled' : ''} data-page="${state.currentPage - 1}">‹</button>`

    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="${i === state.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`
    }

    html += `<button ${state.currentPage >= totalPages ? 'disabled' : ''} data-page="${state.currentPage + 1}">›</button>`

    btns.innerHTML = html
  }

  const render = () => {
    renderTable()
    renderPagination()
  }

  /* ---------- 账号操作 ---------- */
  const deleteEmail = (index) => {
    const data = getEmailData()
    data.splice(index, 1)
    setEmailData(data)
    state.emailData = data
    state.selectedItems = []
    render()
  }

  const batchDelete = () => {
    if (state.selectedItems.length === 0) {
      showToast('请先选择要删除的账号')
      return
    }

    $('#delete-confirm-count').textContent = state.selectedItems.length
    openModal('delete-confirm-modal')
  }

  const executeBatchDelete = () => {
    const selectedIndexes = new Set(state.selectedItems.map(Number))
    const data = getEmailData().filter((item, index) => !selectedIndexes.has(index))
    setEmailData(data)
    state.emailData = data
    state.selectedItems = []
    closeModal('delete-confirm-modal')
    render()
    showToast('删除成功')
  }

  const refreshMicrosoftToken = async (mail) => {
    const tokenResponse = await fetch(CONFIG.REFRESH_TOKEN_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: mail.clientId,
        refresh_token: mail.refreshToken,
        password: getPassword()
      })
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}))
      const error = new Error(errorData.error || `请求失败: ${tokenResponse.status}`)
      error.status = tokenResponse.status
      throw error
    }

    const data = await tokenResponse.json()
    return data.refresh_token || mail.refreshToken
  }

  const batchRefreshTokens = async () => {
    if (state.selectedItems.length === 0) {
      showToast('请先选择要刷新 Token 的账号')
      return
    }

    $('#refresh-token-count').textContent = state.selectedItems.length
    openModal('refresh-token-modal')
  }

  const executeBatchRefreshTokens = async () => {
    if (state.selectedItems.length === 0) {
      closeModal('refresh-token-modal')
      showToast('请先选择要刷新 Token 的账号')
      return
    }

    closeModal('refresh-token-modal')
    showLoading()
    const data = getEmailData()
    let successCount = 0
    let failCount = 0
    let authFailed = false

    const selectedIndexes = new Set(state.selectedItems.map(Number))

    for (const [index, item] of data.entries()) {
      if (!selectedIndexes.has(index)) continue

      try {
        item.refreshToken = await refreshMicrosoftToken(item)
        successCount++
      } catch (err) {
        if (err.status === 401) {
          authFailed = true
          break
        }
        failCount++
        console.error(`刷新 ${item.email} Token 失败:`, err)
      }
    }

    setEmailData(data)
    state.emailData = data
    render()
    hideLoading()

    if (authFailed) {
      showToast(AUTH_ERROR_MESSAGE)
    } else if (failCount > 0) {
      showToast(`刷新完成，成功 ${successCount} 个，失败 ${failCount} 个`)
    } else {
      showToast(`刷新成功，共 ${successCount} 个`)
    }
  }

  /* ---------- 导入 ---------- */
  const importEmails = () => {
    const delimiter = $('#import-delimiter').value.trim()
    const fileInput = $('#import-file')

    if (!delimiter) {
      showToast('请输入分隔符')
      return
    }
    if (!fileInput.files.length) {
      showToast('请选择文件')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const lines = e.target.result.split('\n')
      let data = getEmailData()
      let count = 0

      lines.forEach(line => {
        const fields = line.split(delimiter)
        if (fields.length >= 4) {
          const [email, password, clientId, refreshToken] = fields.map(s => s.trim())
          if (email && password && clientId && refreshToken) {
            data.push({ email, password, clientId, refreshToken })
            count++
          }
        }
      })

      setEmailData(data)
      state.emailData = data
      closeModal('import-modal')
      render()
      showToast(`导入成功，共 ${count} 条`)
    }
    reader.readAsText(fileInput.files[0])
  }

  /* ---------- 邮件列表 ---------- */
  const loadMailList = (refreshToken, clientId, email, mailbox) => {
    showLoading()
    const password = getPassword()
    const apiUrl = `${CONFIG.API_BASE}?refresh_token=${refreshToken}&client_id=${clientId}&email=${email}&mailbox=${mailbox}&response_type=json&password=${password}`

    fetch(apiUrl)
      .then(r => {
        if (!r.ok) {
          if (r.status === 401) throw { status: 401 }
          if (r.status === 500) {
            return r.json().then(d => {
              if (d.error === 'Nothing to fetch') {
                state.mailData = []
                showMailSection()
                renderMailTable()
                return Promise.resolve()
              }
              throw new Error(d.error || '服务器错误')
            })
          }
          throw new Error(`请求失败: ${r.status}`)
        }
        return r.json()
      })
      .then(d => {
        if (d) {
          state.mailData = d
          showMailSection()
          renderMailTable()
        }
      })
      .catch(err => {
        if (err.status === 401) {
          showToast(AUTH_ERROR_MESSAGE)
        } else {
          showToast(err.message || '加载失败')
        }
      })
      .finally(() => hideLoading())
  }

  const showMailSection = () => {
    $$('.section').forEach(s => s.classList.remove('active'))
    $('#mail-section').classList.add('active')
  }

  const showAccountSection = () => {
    $$('.section').forEach(s => s.classList.remove('active'))
    $('#account-section').classList.add('active')
    state.mailData = []
    state.currentMailPage = 1
  }

  const renderMailTable = () => {
    const tbody = $('#mail-table tbody')
    const total = state.mailData.length
    const start = (state.currentMailPage - 1) * CONFIG.MAIL_ITEMS_PER_PAGE
    const end = start + CONFIG.MAIL_ITEMS_PER_PAGE
    const pageData = state.mailData.slice(start, end)

    if (total === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty">暂无邮件</td></tr>`
      return
    }

    tbody.innerHTML = pageData.map((item, i) => `
      <tr>
        <td>${item.send}</td>
        <td>${item.subject}</td>
        <td>${item.date}</td>
        <td><button class="btn btn-sm" data-action="view">查看</button></td>
      </tr>
    `).join('')

    renderMailPagination()
  }

  const renderMailPagination = () => {
    const totalPages = Math.ceil(state.mailData.length / CONFIG.MAIL_ITEMS_PER_PAGE)
    const btns = $('#mail-pagination-btns')

    if (totalPages <= 1) {
      btns.innerHTML = ''
      return
    }

    let html = `<button ${state.currentMailPage <= 1 ? 'disabled' : ''} data-page="${state.currentMailPage - 1}">‹</button>`

    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="${i === state.currentMailPage ? 'active' : ''}" data-page="${i}">${i}</button>`
    }

    html += `<button ${state.currentMailPage >= totalPages ? 'disabled' : ''} data-page="${state.currentMailPage + 1}">›</button>`

    btns.innerHTML = html
  }

  const viewMailDetail = (index) => {
    const item = state.mailData[index]
    if (!item) return

    $('#mail-modal-title').textContent = item.subject
    $('#mail-modal-sender').textContent = item.send
    $('#mail-modal-date').textContent = item.date

    const content = $('#mail-modal-content')
    content.replaceChildren()

    if (item.html) {
      // 用 sandbox iframe 隔离渲染邮件 HTML，阻止脚本访问 localStorage 等父页面资源
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', '')
      iframe.setAttribute('referrerpolicy', 'no-referrer')
      iframe.srcdoc = item.html
      iframe.style.cssText = 'width:100%;border:0;min-height:400px;'
      content.appendChild(iframe)
      iframe.addEventListener('load', () => {
        try {
          const h = iframe.contentDocument?.body?.scrollHeight
          if (h) iframe.style.height = h + 'px'
        } catch (e) { /* 跨源/无 origin,忽略 */ }
      })
    } else {
      const pre = document.createElement('pre')
      pre.textContent = item.text || ''
      pre.style.cssText = 'white-space:pre-wrap;word-wrap:break-word;margin:0;'
      content.appendChild(pre)
    }

    openModal('mail-modal')
  }

  /* ---------- 文件上传拖拽 ---------- */
  const initUpload = () => {
    const box = $('#upload-box')
    const input = $('#import-file')
    const info = $('#file-info')

    box.addEventListener('click', () => input.click())

    input.addEventListener('change', () => {
      if (input.files[0]) {
        info.textContent = input.files[0].name
      }
    })

    box.addEventListener('dragover', e => {
      e.preventDefault()
      box.classList.add('dragover')
    })

    box.addEventListener('dragleave', () => {
      box.classList.remove('dragover')
    })

    box.addEventListener('drop', e => {
      e.preventDefault()
      box.classList.remove('dragover')
      if (e.dataTransfer.files[0]) {
        input.files = e.dataTransfer.files
        info.textContent = e.dataTransfer.files[0].name
      }
    })
  }

  /* ---------- 事件绑定 ---------- */
  const bindEvents = () => {
    // 搜索
    $('#search-input').addEventListener('input', e => {
      state.searchKeyword = e.target.value.trim()
      state.currentPage = 1
      render()
    })

    // 工具栏按钮
    $('#toolbar').addEventListener('click', e => {
      const action = e.target.dataset.action
      if (!action) return

      switch (action) {
        case 'import':
          openModal('import-modal')
          break
        case 'refresh-token':
          batchRefreshTokens()
          break
        case 'delete':
          batchDelete()
          break
      }
    })

    // 账号表格操作
    $('#email-table tbody').addEventListener('click', e => {
      const btn = e.target.closest('button[data-action]')
      if (!btn) return

      const action = btn.dataset.action
      const tr = btn.closest('tr')
      const index = parseInt(tr.dataset.index, 10)

      switch (action) {
        case 'inbox':
          loadMailList(state.emailData[index].refreshToken, state.emailData[index].clientId, state.emailData[index].email, 'INBOX')
          break
        case 'junk':
          loadMailList(state.emailData[index].refreshToken, state.emailData[index].clientId, state.emailData[index].email, 'Junk')
          break
        case 'delete':
          deleteEmail(index)
          break
      }
    })

    // 全选
    $('#select-all').addEventListener('change', e => {
      const filteredIndexes = getFilteredData().map(item => String(item.index))

      if (e.target.checked) {
        state.selectedItems = [...new Set([...state.selectedItems, ...filteredIndexes])]
      } else {
        state.selectedItems = state.selectedItems.filter(index => !filteredIndexes.includes(index))
      }

      render()
    })

    // 单选
    $('#email-table tbody').addEventListener('change', e => {
      if (e.target.type !== 'checkbox') return

      if (e.target.checked) {
        state.selectedItems = [...new Set([...state.selectedItems, e.target.dataset.index])]
      } else {
        state.selectedItems = state.selectedItems.filter(index => index !== e.target.dataset.index)
      }

      updateSelectAllState()
    })

    // 分页点击
    $('#pagination-btns').addEventListener('click', e => {
      const btn = e.target.closest('button[data-page]')
      if (btn && !btn.disabled) {
        state.currentPage = parseInt(btn.dataset.page, 10)
        render()
      }
    })

    // 每页条数
    $('#per-page').addEventListener('change', e => {
      state.itemsPerPage = parseInt(e.target.value, 10)
      state.currentPage = 1
      render()
    })

    // 邮件表格操作
    $('#mail-table tbody').addEventListener('click', e => {
      const btn = e.target.closest('button[data-action]')
      if (!btn) return

      const tr = btn.closest('tr')
      const rows = [...tr.parentNode.children]
      const index = rows.indexOf(tr)
      const globalIndex = (state.currentMailPage - 1) * CONFIG.MAIL_ITEMS_PER_PAGE + index

      if (btn.dataset.action === 'view') {
        viewMailDetail(globalIndex)
      }
    })

    // 邮件分页
    $('#mail-pagination-btns').addEventListener('click', e => {
      const btn = e.target.closest('button[data-page]')
      if (btn && !btn.disabled) {
        state.currentMailPage = parseInt(btn.dataset.page, 10)
        renderMailTable()
      }
    })

    // 返回按钮
    $('#back-btn').addEventListener('click', showAccountSection)


    // 刷新 Token 确认弹窗
    $('#refresh-token-cancel').addEventListener('click', () => closeModal('refresh-token-modal'))
    $('#refresh-token-confirm').addEventListener('click', executeBatchRefreshTokens)

    // 批量删除确认弹窗
    $('#delete-confirm-cancel').addEventListener('click', () => closeModal('delete-confirm-modal'))
    $('#delete-confirm-submit').addEventListener('click', executeBatchDelete)

    // 导入弹窗按钮
    $('#import-confirm').addEventListener('click', importEmails)

    // 关闭模态框
    $$('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) closeAllModals()
      })
    })

    // 密码保存
    $('#toolbar-password').addEventListener('input', e => setPassword(e.target.value.trim()))

    // 初始化密码值
    const pwd = getPassword()
    if (pwd) $('#toolbar-password').value = pwd
  }

  /* ---------- 初始化 ---------- */
  const init = () => {
    state.emailData = getEmailData()
    render()
    initUpload()
    bindEvents()

    // 暴露全局
    window.mailApp = {
      closeModal: closeAllModals
    }

    console.log('%c感谢您使用本项目！', 'color: #666; font-size: 11px;')
    console.log('%c作者: HChaohui  开源地址: https://github.com/HChaoHui/msOauth2api', 'color: #007BFF; font-size: 12px;')
  }

  document.addEventListener('DOMContentLoaded', init)
})()
