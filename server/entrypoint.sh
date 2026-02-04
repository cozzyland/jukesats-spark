#!/bin/sh
set -e

# Fix data volume permissions for node user
if [ -d /data ]; then
  chown -R node:node /data
fi

# Drop to node user
exec gosu node "$@"
