#!/bin/bash
cd "$(dirname "$0")"

echo "Start webserver"
npx http-server dist -S -s -p 8080 -c-1 &
#npx http-server dist -S &    # shows URL of server

while inotifywait -q -r -e modify -e delete -e move src; do    
    #echo "REBUILD"
    echo "$(date +"%H:%M:%S") rebuilding"
    ./build.sh
    #echo "✅ DONE"
    echo "$(date +"%H:%M:%S") ✅ done"    
done
