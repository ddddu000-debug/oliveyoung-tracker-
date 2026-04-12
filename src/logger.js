const fs   = require('fs');
const path = require('path');

function getLogPath() {
  const today = new Date().toISOString().slice(0, 10);
  return path.join('logs', `${today}.log`);
}

function write(level, message) {
  const time = new Date().toISOString();
  const line = `[${time}] [${level}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(getLogPath(), line + '\n');
  } catch (e) {
    // 로그 쓰기 실패는 무시
  }
}

module.exports = {
  info:  msg => write('INFO ', msg),
  warn:  msg => write('WARN ', msg),
  error: msg => write('ERROR', msg),
};
