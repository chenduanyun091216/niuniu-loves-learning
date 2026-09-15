chrome.runtime.onInstalled.addListener(() => {
  console.log('[牛牛爱学习] 已安装 - 学习助手 by Mr.Chen');
});

// 接收来自 popup 的日志（如需要）
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'LOG') console.log('[popup]', msg.msg);
});
