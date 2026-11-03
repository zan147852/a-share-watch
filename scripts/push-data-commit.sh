#!/usr/bin/env bash
# Push the data commit the screen workflow just created.
#
# Daily public/data commits are large enough that `git push` sometimes dies
# with HTTP 408, "send-pack: unexpected disconnect while reading sideband
# packet", and "the remote end hung up unexpectedly". Git then prints
# "Everything up-to-date" and still exits 1; the commit is not on the remote.
# Retry only that kind of transport failure.
#
# Rebase conflicts, authentication/permission errors, and any other push
# failure stop the job on the first occurrence.
set -euo pipefail

: "${PUSH_MAX_ATTEMPTS:=5}"
: "${PUSH_RETRY_DELAY_SECONDS:=10}"

# Default http.postBuffer is 1 MiB. A full day of screen JSON can cross that
# and switch to chunked Transfer-Encoding, which GitHub has answered with 408.
# 64 MiB keeps this push as one request body. HTTP/1.1 avoids the HTTP/2
# sideband disconnect that shows up with the same 408.
GIT_PUSH=(git -c http.version=HTTP/1.1 -c http.postBuffer=67108864 push)

classify_push_failure() {
  local log=$1
  if printf '%s\n' "$log" | grep -Eq 'Authentication failed|could not read Username|Invalid username or token|terminal prompts disabled|Permission to .+ denied|The requested URL returned error: 40[13]'; then
    printf '%s\n' auth
    return 0
  fi
  if printf '%s\n' "$log" | grep -Eq 'hook declined|protected branch|remote rejected|src refspec|cannot lock ref'; then
    printf '%s\n' fatal
    return 0
  fi
  if printf '%s\n' "$log" | grep -Eq 'non-fast-forward|\[rejected\]|failed to push some refs|Updates were rejected'; then
    printf '%s\n' rejected
    return 0
  fi
  if printf '%s\n' "$log" | grep -Eq 'HTTP 408|HTTP 429|HTTP 50[0234]|The requested URL returned error: 50[0234]|send-pack: unexpected disconnect|the remote end hung up unexpectedly|early EOF|Connection timed out|Failed to connect|Could not resolve host|RPC failed|curl (18|28|55|56)([^0-9]|$)|SSL connection|GnuTLS|OpenSSL SSL_'; then
    printf '%s\n' transient
    return 0
  fi
  printf '%s\n' fatal
}

rebase_onto_main() {
  git fetch origin main
  if ! git rebase origin/main; then
    echo "rebase onto origin/main failed; not pushing over a conflict"
    git status --short || true
    exit 1
  fi
}

push_with_retry() {
  local attempt=1
  local delay="$PUSH_RETRY_DELAY_SECONDS"
  local push_log push_status kind
  while [ "$attempt" -le "$PUSH_MAX_ATTEMPTS" ]; do
    set +e
    push_log=$("${GIT_PUSH[@]}" 2>&1)
    push_status=$?
    set -e
    printf '%s\n' "$push_log"
    if [ "$push_status" -eq 0 ]; then
      return 0
    fi
    kind=$(classify_push_failure "$push_log")
    if [ "$kind" = "auth" ] || [ "$kind" = "fatal" ]; then
      echo "git push failed (${kind}); not retrying"
      return 1
    fi
    if [ "$attempt" -eq "$PUSH_MAX_ATTEMPTS" ]; then
      echo "git push failed after ${PUSH_MAX_ATTEMPTS} attempts (${kind})"
      return 1
    fi
    if [ "$kind" = "transient" ]; then
      echo "transient git push failure (attempt ${attempt}/${PUSH_MAX_ATTEMPTS}); retrying in ${delay}s"
      sleep "$delay"
      delay=$((delay * 2))
    else
      echo "git push rejected by the remote (attempt ${attempt}/${PUSH_MAX_ATTEMPTS}); rebasing before retry"
    fi
    attempt=$((attempt + 1))
    rebase_onto_main
  done
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  rebase_onto_main
  push_with_retry
fi
