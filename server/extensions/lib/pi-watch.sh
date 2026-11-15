#!/bin/sh
# pi-watch: watches one command, process, log or file on this machine for beezy, which installs this
# script over SSH and reads the result back the same way. See docs/process-watches.md.
#
# Each watch keeps its state in ~/.pi-watch/<id>/:
#   heartbeat  epoch seconds, renewed every few seconds while the watcher runs
#   result     key=value lines, written once when the watch ends (or is cancelled)
#   log        output of a `run` watch
#
#   pi-watch start <id> [--quiet <seconds> [--quiet-file <log>]] run <folder> <command>
#   pi-watch start <id> [--quiet <seconds> --quiet-file <log>] pid <pid>
#   pi-watch start <id> [--quiet <seconds>] log <file> <pattern> [<failure pattern>]
#   pi-watch start <id> file <path>
#   pi-watch status <id>...
#
# --quiet also ends the watch when the log has not grown for that many seconds (a hang); for run and
# log watches the log is their own unless --quiet-file names another.
#   pi-watch cancel <id>
set -u
ROOT="$HOME/.pi-watch"
CHECK=${PI_WATCH_CHECK:-10}

now() { date +%s; }
fail() { printf '%s\n' "$*" >&2; exit 1; }

# Running and not a zombie (kill -0 succeeds on zombies; ps tells them apart where it exists).
alive() {
  kill -0 "$1" 2>/dev/null || return 1
  s=$(ps -o stat= -p "$1" 2>/dev/null) || return 0
  case $s in Z*) return 1 ;; esac
}

# When a process started, so a reused pid is not taken for the watched process.
started() {
  if [ -r "/proc/$1/stat" ]; then sed 's/^.*) //' "/proc/$1/stat" 2>/dev/null | cut -d' ' -f20
  else ps -o lstart= -p "$1" 2>/dev/null; fi
}

beat() { now > "$dir/heartbeat.tmp" && mv -f "$dir/heartbeat.tmp" "$dir/heartbeat"; }

# The first result wins, so a cancel and a natural end cannot overwrite one another.
finish() {
  [ -f "$dir/result" ] && return 0
  { for kv in "$@"; do printf '%s\n' "$kv"; done; printf 'armed=%s\nended=%s\n' "$(cat "$dir/armed" 2>/dev/null)" "$(now)"; } > "$dir/result.tmp" && mv -f "$dir/result.tmp" "$dir/result"
}

# The output since the watch started, first line matching an extended regex.
first_match() { tail -c +"$(($2 + 1))" "$1" 2>/dev/null | grep -E -m1 -e "$3" | cut -c1-300; }

# True (and the watch finished) once the quiet file has not grown for the quiet time; a missing file counts from arming.
quiet_since= quiet_size=
stalled() {
  [ -n "$quiet" ] || return 1
  qsize=$(wc -c < "$quiet_file" 2>/dev/null | tr -d ' ')
  t=$(now)
  if [ -z "$quiet_since" ] || [ "$qsize" != "$quiet_size" ]; then
    [ -z "$quiet_since" ] && [ -z "$qsize" ] && quiet_since=$(cat "$dir/armed") || quiet_since=$t
    quiet_size=$qsize
    return 1
  fi
  [ $((t - quiet_since)) -ge "$quiet" ] || return 1
  finish status=quiet "idle=$((t - quiet_since))"
}

watch() {
  id=$1 kind=$2; shift 2
  dir="$ROOT/$id"
  echo $$ > "$dir/watcher"
  trap '' HUP
  quiet=$(cat "$dir/quiet" 2>/dev/null) quiet_file=$(cat "$dir/quiet-file" 2>/dev/null)
  case $kind in
    run)
      # The code file survives the zombie problem: it is written by the subshell itself.
      ( cd "${1:-$HOME}" && sh -c "$2"; echo $? > "$dir/code" ) > "$dir/log" 2>&1 < /dev/null &
      child=$!
      echo "$child" > "$dir/target"
      while [ ! -f "$dir/code" ] && alive "$child"; do beat; stalled && return; sleep $CHECK; done
      wait "$child"
      code=$(cat "$dir/code" 2>/dev/null)
      if [ -n "$code" ]; then finish status=exited "code=$code"; else finish status=gone; fi ;;
    pid)
      pid=$1 start=$(started "$1")
      while alive "$pid" && [ "$(started "$pid")" = "$start" ]; do beat; stalled && return; sleep $CHECK; done
      finish status=gone ;;
    log)
      file=$1 pattern=$2 bad=${3:-}
      from=$(cat "$dir/offset")
      while :; do
        beat
        if [ -f "$file" ]; then
          size=$(wc -c < "$file" | tr -d ' ')
          [ "$size" -lt "$from" ] && from=0 # truncated or replaced
          if [ -n "$bad" ]; then line=$(first_match "$file" "$from" "$bad"); [ -n "$line" ] && { finish status=failed "match=$line"; break; }; fi
          line=$(first_match "$file" "$from" "$pattern"); [ -n "$line" ] && { finish status=matched "match=$line"; break; }
        fi
        stalled && break
        sleep $CHECK
      done ;;
    file)
      path=$1 last=
      while :; do
        beat
        # A file that was there already counts once it changes after the watch started.
        if [ -e "$path" ] && { [ ! -f "$dir/existed" ] || [ -n "$(find "$path" -prune -newer "$dir/armed" 2>/dev/null)" ]; }; then
          if [ -d "$path" ]; then size=dir; else size=$(wc -c < "$path" | tr -d ' '); fi
          [ "$size" = "$last" ] && { finish status=ready "size=$size"; break; }
          last=$size
        fi
        sleep $CHECK
      done ;;
  esac
  beat
}

start() {
  id=$1; shift
  quiet= quiet_file=
  while :; do
    case ${1:-} in
      --quiet) quiet=$2; shift 2 ;;
      --quiet-file) quiet_file=$2; shift 2 ;;
      *) break ;;
    esac
  done
  [ $# -ge 1 ] || fail "usage: pi-watch start <id> [--quiet <seconds>] <kind> ..."
  kind=$1; shift
  case $id in '' | *[!A-Za-z0-9-]*) fail "Invalid watch id" ;; esac
  case $quiet in '' | *[!0-9]*) [ -z "$quiet" ] || fail "Invalid quiet time: $quiet" ;; esac
  # Watches older than two weeks are gone; a running one renews its folder with every heartbeat.
  find "$ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} + 2>/dev/null
  dir="$ROOT/$id"
  mkdir -p "$dir" || fail "Cannot create $dir"
  case $kind in
    run)
      [ $# -eq 2 ] || fail "run needs a folder and a command"
      [ -z "$1" ] || [ -d "$1" ] || fail "No such folder: $1"
      echo "$dir/log" > "$dir/tail" ;;
    pid)
      [ $# -eq 1 ] || fail "pid needs a process id"
      alive "$1" || { rm -rf "$dir"; fail "No running process $1"; }
      echo "$1" > "$dir/target" ;;
    log)
      [ $# -ge 2 ] || fail "log needs a file and a pattern"
      for p in "$2" "${3:-x}"; do echo | grep -E -e "$p" > /dev/null 2>&1; [ $? -eq 2 ] && { rm -rf "$dir"; fail "Invalid pattern: $p"; }; done
      printf '%s\n' "$1" > "$dir/tail"
      if [ -f "$1" ]; then wc -c < "$1" | tr -d ' ' > "$dir/offset"; else echo 0 > "$dir/offset"; fi ;;
    file)
      [ $# -eq 1 ] || fail "file needs a path"
      [ -e "$1" ] && : > "$dir/existed" ;;
    *) fail "Unknown kind: $kind" ;;
  esac
  if [ -n "$quiet" ]; then
    case $kind in run) : "${quiet_file:=$dir/log}" ;; log) : "${quiet_file:=$1}" ;; esac
    [ -n "$quiet_file" ] || { rm -rf "$dir"; fail "--quiet needs --quiet-file for $kind watches"; }
    echo "$quiet" > "$dir/quiet"
    printf '%s\n' "$quiet_file" > "$dir/quiet-file"
    [ -f "$dir/tail" ] || printf '%s\n' "$quiet_file" > "$dir/tail"
  fi
  now > "$dir/armed"
  beat
  if command -v setsid > /dev/null 2>&1; then detach=setsid; else detach=; fi
  nohup $detach sh "$0" _watch "$id" "$kind" "$@" < /dev/null > /dev/null 2>&1 &
  # Give a run a moment to start, so its pid can be reported.
  [ "$kind" = run ] && { i=0; while [ ! -f "$dir/target" ] && [ $i -lt 20 ]; do sleep 0.1 2>/dev/null || sleep 1; i=$((i + 1)); done; }
  printf 'ok\n'
  [ -f "$dir/target" ] && printf 'target=%s\n' "$(cat "$dir/target")"
  return 0
}

status() {
  t=$(now)
  for id in "$@"; do
    dir="$ROOT/$id"
    printf '@@watch %s\nnow=%s\n' "$id" "$t"
    if [ ! -d "$dir" ]; then
      echo state=missing
    else
      printf 'heartbeat=%s\n' "$(cat "$dir/heartbeat" 2>/dev/null)"
      [ -f "$dir/target" ] && printf 'target=%s\n' "$(cat "$dir/target")"
      if [ -f "$dir/result" ]; then
        echo state=done
        cat "$dir/result"
        out=$(cat "$dir/tail" 2>/dev/null)
        if [ -n "$out" ] && [ -f "$out" ]; then echo @@tail; tail -n 40 "$out" | cut -c1-500; fi
      else
        echo state=running
      fi
    fi
    printf '@@end %s\n' "$id"
  done
}

cancel() {
  dir="$ROOT/$1"
  [ -d "$dir" ] || return 0
  finish status=cancelled
  w=$(cat "$dir/watcher" 2>/dev/null)
  [ -n "$w" ] && kill "$w" 2>/dev/null
  return 0
}

command=${1:-}
[ $# -gt 0 ] && shift
case $command in
  start) [ $# -ge 2 ] || fail "usage: pi-watch start <id> <kind> ..."; start "$@" ;;
  _watch) watch "$@" ;;
  status) status "$@" ;;
  cancel) [ $# -eq 1 ] || fail "usage: pi-watch cancel <id>"; cancel "$1" ;;
  *) fail "usage: pi-watch start|status|cancel ..." ;;
esac
