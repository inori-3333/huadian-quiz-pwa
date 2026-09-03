// The Android file:// bundle uses the same UI without browser installation controls.
;(function setupPwa() {
  if (!['http:', 'https:'].includes(location.protocol)) return

  let installPrompt = null
  let registration = null
  let offlineReady = false
  let cacheFailed = false
  let applyingUpdate = false
  let hadController = Boolean(navigator.serviceWorker?.controller)
  const updateNotice = document.querySelector('#update-notice')
  const updateButton = document.querySelector('#apply-update')
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  const apple = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  function syncStatus() {
    connectionStatus.classList.remove('hidden')
    connectionStatus.classList.toggle('offline', !navigator.onLine || cacheFailed)
    connectionStatus.textContent = !navigator.onLine
      ? (offlineReady ? '离线刷题中' : '离线 · 缓存未完成')
      : offlineReady ? '离线已就绪' : cacheFailed ? '离线缓存失败' : '正在缓存题库…'
    connectionStatus.title = offlineReady ? '全部题库和安规原文已缓存，可断网使用' : '请保持联网，等待全部资源缓存完成'
  }

  function showInstallHelp() {
    const previousFocus = document.activeElement
    const close = () => { modalRoot.innerHTML = ''; previousFocus?.focus() }
    const steps = apple
      ? [['用 Safari 打开本页', '在 iPhone 或 iPad 上打开当前网页。'], ['轻点“共享”按钮', '找到工具栏中带向上箭头的方框。'], ['选择“添加到主屏幕”', '添加后，从主屏幕图标进入应用。']]
      : [['打开浏览器菜单', '使用 Chrome 或 Edge 打开当前网页。'], ['选择安装应用', '在地址栏或浏览器菜单中找到“安装应用”或“添加到主屏幕”。'], ['等待“离线已就绪”', '安装选项由浏览器提供，也可以直接在网页中刷题。']]
    modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal install-guide" role="dialog" aria-modal="true" aria-label="安装应用">
      <div class="modal-head"><h2>${apple ? '添加到主屏幕' : '安装华电刷题'}</h2><button class="modal-close" type="button" aria-label="关闭">×</button></div>
      <ol>${steps.map(([title, description], index) => `<li><span>${index + 1}</span><div><strong>${title}</strong><p>${description}</p></div></li>`).join('')}</ol>
      <p class="library-note">请等待页面显示“离线已就绪”后再断网。清除本站浏览器数据会同时删除本地进度。</p>
      <button class="primary-button full-button modal-done" type="button">知道了</button>
    </section></div>`
    modalRoot.querySelector('.modal-close').addEventListener('click', close)
    modalRoot.querySelector('.modal-done').addEventListener('click', close)
    modalRoot.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) close() })
    modalRoot.querySelector('.modal').addEventListener('keydown', event => {
      if (event.key === 'Escape') close()
      if (event.key === 'Tab') {
        const first = modalRoot.querySelector('.modal-close')
        const last = modalRoot.querySelector('.modal-done')
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    })
    modalRoot.querySelector('.modal-close').focus()
  }

  installButton.textContent = apple ? '添加到主屏幕' : '安装应用'
  installButton.classList.toggle('hidden', standalone())
  installButton.addEventListener('click', async () => {
    if (!installPrompt) return showInstallHelp()
    const prompt = installPrompt
    installPrompt = null
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      if (choice.outcome === 'accepted') installButton.classList.add('hidden')
    } catch { showInstallHelp() }
  })
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    installPrompt = event
    installButton.classList.toggle('hidden', standalone())
  })
  window.addEventListener('appinstalled', () => installButton.classList.add('hidden'))

  function offerUpdate() {
    if (registration?.waiting && navigator.serviceWorker.controller) updateNotice.classList.remove('hidden')
  }

  updateButton.addEventListener('click', () => {
    saveCurrentSession()
    if (!saveState()) return showToast('进度保存失败，请允许本地存储后再更新')
    if (!registration?.waiting) return location.reload()
    applyingUpdate = true
    updateButton.disabled = true
    updateButton.textContent = '正在更新…'
    registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  })

  window.addEventListener('online', () => {
    syncStatus()
    registration?.update().catch(() => {})
  })
  window.addEventListener('offline', syncStatus)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) registration?.update().catch(() => {})
    else if (document.visibilityState === 'hidden') saveCurrentSession()
  })
  window.addEventListener('pagehide', saveCurrentSession)

  syncStatus()
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    cacheFailed = true
    syncStatus()
    connectionStatus.textContent = '仅在线使用'
    connectionStatus.title = '离线功能需要支持 Service Worker 的浏览器及 HTTPS 或 localhost'
    return
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applyingUpdate) return location.reload()
    offlineReady = true
    syncStatus()
    if (hadController) {
      updateNotice.querySelector('span').textContent = '应用已更新，刷新后使用新版。'
      updateButton.textContent = '保存进度并刷新'
      updateNotice.classList.remove('hidden')
    }
    hadController = true
  })

  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(async worker => {
    registration = worker
    offerUpdate()
    const watchInstallation = () => {
      const installing = worker.installing
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed') offerUpdate()
        if (installing.state === 'redundant' && !offlineReady) { cacheFailed = true; syncStatus() }
      })
    }
    watchInstallation()
    worker.addEventListener('updatefound', watchInstallation)
    await navigator.serviceWorker.ready
    offlineReady = true
    syncStatus()
  }).catch(error => {
    cacheFailed = true
    syncStatus()
    console.warn('Offline cache unavailable', error)
  })
})()
