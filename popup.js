const logEl = document.getElementById('log');
const fillEl = document.getElementById('progress-fill');
const progText = document.getElementById('progress-text');
const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');

let running = false;
let activeRunId = null;
let lastLogIndex = 0;
let polling = false;

function log(msg, type) {
  const now = new Date();
  const ts = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(value => String(value).padStart(2, '0'))
    .join(':');
  const line = document.createElement('div');
  line.style.color = type === 'ERROR' ? '#f56c6c' : type === 'SUCCESS' ? '#67c23a' : type === 'WARN' ? '#e6a23c' : '#dcdcdc';
  line.textContent = `[${ts}] ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  console.log(`[牛牛爱学习] ${msg}`);
}

function setProgress(done, total) {
  const pct = total > 0 ? Math.floor(done / total * 100) : 0;
  fillEl.style.width = pct + '%';
  progText.textContent = `总进度: ${done}/${total} (${pct}%)`;
}

function appendBrushLogs(state) {
  if (!state || state.runId !== activeRunId) return;
  const logs = Array.isArray(state.logs) ? state.logs : [];
  while (lastLogIndex < logs.length) {
    const item = logs[lastLogIndex++];
    if (typeof item === 'string') log(item.replace(/^\[.*?\]\s*/, ''));
    else if (item?.msg) log(item.msg, item.type);
  }
  const progressTotal = state.todoCount > 0 ? state.todoCount : state.total;
  if (progressTotal > 0) setProgress(state.done || 0, progressTotal);
}

// 在页面 MAIN world 中执行的函数（字符串化后注入）
const pageFunc = (runId) => {
  function emit(state, msg, type) {
    state.logs.push({ msg, type });
    state.updatedAt = Date.now();
  }

  function getStore() {
    const el = document.querySelector('#app');
    try {
      if (el?.__vue_app__?.config?.globalProperties?.$store) return el.__vue_app__.config.globalProperties.$store;
      if (el?.__vue__?.$store) return el.__vue__.$store;
      if (window.$store) return window.$store;
      if (window.__store) return window.__store;
      for (const n of document.querySelectorAll('*')) {
        if (n.__vue__?.$store) return n.__vue__.$store;
        if (n.__vue_app__?.config?.globalProperties?.$store) return n.__vue_app__.config.globalProperties.$store;
      }
    } catch (e) {}
    return null;
  }

  // 等待 store 和 fileList 就绪
  return new Promise(async (resolve) => {
    const state = {
      runId, logs: [], total: 0, done: 0, ok: 0, fail: 0,
      stopped: false, finished: false, updatedAt: Date.now()
    };
    const pendingStop = window.__ksx_stopRequested === runId;
    window.__ksx_stopRequested = null;
    window.__ksx_brushState = state;
    window.__ksx_stopBrush = () => {
      if (state.finished || state.stopped) return;
      state.stopped = true;
      emit(state, '用户停止', 'WARN');
      window.__ksx_abortBrush?.abort();
    };
    if (pendingStop) window.__ksx_stopBrush();

    let store = null;
    for (let i = 0; i < 15; i++) {
      if (state.stopped) {
        state.finished = true;
        emit(state, '任务已停止', 'WARN');
        return resolve(state);
      }
      store = getStore();
      if (store && store.state?.videoDetail?.courseInfo?.fileList?.length) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!store) {
      state.finished = true;
      return resolve({ ...state, error: 'NO_STORE' });
    }

    const fileList = store.state.videoDetail.courseInfo.fileList;
    if (!fileList || !fileList.length) {
      state.finished = true;
      return resolve({ ...state, error: 'NO_FILELIST' });
    }

    const token = store.state.token || '';
    const userId = store.state.user?.id;
    const routeQuery = location.search || ((location.hash || '').split('?')[1] || '');
    const up = new URLSearchParams(routeQuery);
    const popProcessId = up.get('popProcessId') || store.state?.examProcessInfo?.processInfo?.id || '';
    const courseName = store.state.videoDetail.courseInfo.documentsData?.courseName || '';
    const executeUrl = 'https://exam.kaoshixing.com/staff_course/excute';

    if (!token || userId == null || !popProcessId) {
      state.finished = true;
      emit(state, '❌ 未获取完整接口参数，请刷新课程页面后重试', 'ERROR');
      return resolve({ ...state, error: 'MISSING_PARAMS', courseName, total: fileList.length, todoCount: 0 });
    }

    const todo = fileList.filter(f => (f.finishPercent || 0) < 100);
    state.total = todo.length;
    emit(state, `开始自动执行 ${courseName || '当前课程'}`);
    if (todo.length === 0) {
      state.total = fileList.length;
      state.done = fileList.length;
      state.finished = true;
      emit(state, '全部100%，不用刷', 'SUCCESS');
      return resolve({ ...state, ok: true, courseName, total: fileList.length, todoCount: 0 });
    }

    for (let i = 0; i < todo.length; i++) {
      if (state.stopped) break;
      await new Promise(x => setTimeout(x, 0));
      if (state.stopped) break;
      const f = todo[i];
      const fid = f.studyRecordFileId;
      const fname = f.fileName || '未知文件';
      const st = Math.round(f.fileTime || 3600);
      emit(state, `[${i + 1}/${todo.length}] ${fname} (id=${fid}) 时长=${st}s 当前${f.finishPercent || 0}%`);

      let finishedChapter = false;
      let failed = false;
      let lastPlace = 0;
      let chunkNo = 0;
      while (!state.stopped && !finishedChapter) {
        await new Promise(x => setTimeout(x, 1000));
        if (state.stopped) break;

        chunkNo++;
        const studyTime = Math.floor(Math.random() * 31) + 20;
        lastPlace = Math.round((lastPlace + studyTime / 2) * 1000000) / 1000000;
        let accepted = false;

        for (let tryN = 1; tryN <= 3; tryN++) {
          if (state.stopped) break;
          const controller = new AbortController();
          window.__ksx_abortBrush = controller;
          try {
            const r = await fetch(executeUrl, {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token, userId, methodName: 'updateFileStudyTime',
                jsonParam: { studyRecordFileId: fid, studyTime, lastPlace, popProcessId }
              }), signal: controller.signal
            });
            const raw = await r.text();
            let d;
            try {
              d = JSON.parse(raw);
            } catch (e) {
              const isXmlOrHtml = /^\s*</.test(raw);
              const detail = isXmlOrHtml ? 'XML/HTML' : raw.trim() ? '非JSON响应' : '空响应';
              emit(state, `  ❌ 接口返回${detail}（HTTP ${r.status}），重试${tryN}`, 'ERROR');
            }
            if (d) {
              const code = d.code;
              const msg = d.message || d.englishMessage || '';
              const biz = (d.data && d.data.bizContent) || {};
              const fp = biz.finishPercent != null ? biz.finishPercent : (d.data && d.data.finishPercent);
              if (code === 200 || code === 0 || msg === 'OK' || msg === '一切正常') {
                accepted = true;
                if (fp != null) f.finishPercent = fp;
                if (biz.finishedChapter) {
                  f.finishPercent = 100;
                  emit(state, `  ✅ done~ 本次增加${studyTime}秒，当前进度${fp != null ? fp + '%' : '100%'}`, 'SUCCESS');
                  finishedChapter = true;
                } else {
                  emit(state, `  📈 本次增加时长${studyTime}秒，当前进度${fp != null ? fp + '%' : '未知'}`, 'INFO');
                }
                break;
              }
              emit(state, `  ⚠️ 业务异常 code=${code} msg=${msg} 重试${tryN}`, 'WARN');
            }
          } catch (e) {
            if (state.stopped || e.name === 'AbortError') break;
            emit(state, `  ❌ 异常 ${e.message} 重试${tryN}`, 'ERROR');
          } finally {
            if (window.__ksx_abortBrush === controller) window.__ksx_abortBrush = null;
          }
          if (!accepted && !state.stopped && tryN < 3) await new Promise(x => setTimeout(x, 2000));
        }

        if (state.stopped) break;
        if (!accepted) {
          failed = true;
          emit(state, `  ❌ 第${chunkNo}次提交失败，结束当前章节`, 'ERROR');
          break;
        }
      }
      if (state.stopped) break;
      if (finishedChapter) state.ok++;
      else if (failed) state.fail++;
      state.done = state.ok + state.fail;
      window.__ksx_progress = { done: state.done, total: state.total, ok: state.ok, fail: state.fail };
    }

    state.finished = true;
    if (state.stopped) {
      emit(state, `任务已停止，成功${state.ok} 失败${state.fail} 已处理${state.done}/${todo.length}`, 'WARN');
    } else {
      emit(state, `🏁 完成 成功${state.ok} 失败${state.fail} 总${todo.length}`, state.fail ? 'WARN' : 'SUCCESS');
    }
    return resolve({ ...state, courseName, total: fileList.length, todoCount: todo.length });
  });
};

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function startBrush() {
  if (running) return;
  running = true;
  activeRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  lastLogIndex = 0;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  logEl.innerHTML = '';
  setProgress(0, 0);

  const tab = await getTab();
  if (!tab?.id) {
    log('未找到当前标签页', 'ERROR');
    running = false;
    startBtn.disabled = false;
    stopBtn.disabled = false;
    return;
  }

  log('开始检测页面数据...');
  let result;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: pageFunc,
      args: [activeRunId]
    });
    result = results?.[0]?.result;
  } catch (e) {
    log(`注入失败: ${e.message}`, 'ERROR');
    running = false; startBtn.disabled = false; stopBtn.disabled = false; return;
  }

  if (!result) { log('未获取到执行结果', 'ERROR'); running = false; startBtn.disabled = false; stopBtn.disabled = false; return; }

  appendBrushLogs(result);

  if (result.error === 'NO_STORE') {
    log('❌ 未检测到数据。请在视频播放页，点开视频等3秒后再试。', 'ERROR');
    log('提示：F12 Console 执行 document.querySelector("#app").__vue_app__ 排查', 'WARN');
  } else if (result.error === 'NO_FILELIST') {
    log('❌ 未获取到文件列表。确认已进入课程视频明细页。', 'ERROR');
  } else if (result.error === 'MISSING_PARAMS') {
    log('❌ 未获取完整接口参数，请刷新课程页面后重试。', 'ERROR');
  } else {
    if (result.courseName) log(`课程: ${result.courseName}`, 'SUCCESS');
    log(`共${result.total}个，待刷${result.todoCount}个`, 'INFO');
    if (result.todoCount === 0) setProgress(result.total, result.total);
    if (!result.stopped && result.todoCount > 0) {
      if (result.ok > 0) log('🎉 刷课完成，刷新页面查看进度', 'SUCCESS');
    }
  }

  running = false;
  startBtn.disabled = false;
  stopBtn.disabled = false;
}

stopBtn.addEventListener('click', async () => {
  if (!running) return;
  stopBtn.disabled = true;
  log('正在发送停止信号...', 'WARN');
  const tab = await getTab();
  if (tab?.id) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN',
        func: (runId) => {
          if (window.__ksx_brushState?.runId === runId && window.__ksx_stopBrush) window.__ksx_stopBrush();
          else window.__ksx_stopRequested = runId;
        },
        args: [activeRunId]
      });
    } catch (e) {
      log(`停止信号发送失败: ${e.message}`, 'ERROR');
    }
  }
  log('已发送停止信号，等待当前请求结束...', 'WARN');
});

startBtn.addEventListener('click', startBrush);

// 轮询进度（MAIN world 写入 window.__ksx_progress）
setInterval(async () => {
  if (!running || polling) return;
  polling = true;
  const tab = await getTab();
  if (!tab?.id) { polling = false; return; }
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN',
      func: () => window.__ksx_brushState || null
    });
    appendBrushLogs(res?.[0]?.result);
  } catch (e) {}
  polling = false;
}, 1500);

log('就绪。请进入视频播放页后点「开始学习」', 'INFO');
