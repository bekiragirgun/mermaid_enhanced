#!/bin/bash

APP_NAME="Mermaid Editor"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$APP_DIR/.server.pid"
LOG_FILE="$APP_DIR/server.log"
NODE_SCRIPT="server.js"

cd "$APP_DIR"

kill_port() {
  local port="${PORT:-3000}"
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "Port $port kullanan işlemler sonlandırılıyor: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null
    sleep 1
  fi
}

start() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "$APP_NAME zaten çalışıyor (PID: $(cat "$PID_FILE"))"
    return 1
  fi

  echo "$APP_NAME başlatılıyor..."
  nohup node "$NODE_SCRIPT" > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1

  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "$APP_NAME başlatıldı (PID: $(cat "$PID_FILE"))"
    echo "http://localhost:${PORT:-3000}"
  else
    echo "Başlatma başarısız. Log: $LOG_FILE"
    rm -f "$PID_FILE"
    return 1
  fi
}

stop() {
  local pid

  if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      echo "$APP_NAME durduruluyor (PID: $pid)..."
      kill "$pid"
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid"
      fi
    fi
    rm -f "$PID_FILE"
  fi

  kill_port
  echo "$APP_NAME durduruldu."
}

restart() {
  stop
  sleep 1
  start
}

build() {
  echo "Bağımlılıklar yükleniyor..."
  npm install
  echo "Build tamamlandı."
}

status() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "$APP_NAME çalışıyor (PID: $(cat "$PID_FILE"))"
  else
    echo "$APP_NAME çalışmıyor."
    rm -f "$PID_FILE" 2>/dev/null
  fi
}

case "$1" in
  start)   start ;;
  stop)    stop ;;
  restart) restart ;;
  build)   build ;;
  status)  status ;;
  *)
    echo "Kullanım: $0 {start|stop|restart|build|status}"
    exit 1
    ;;
esac
