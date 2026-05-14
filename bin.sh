#!/bin/bash
echo "Compiling webserver standalone binaries (output to bin/)"

mkdir -p bin

echo "compiling linux version..."
rm bin/senf-linux-amd64
env GOOS=linux GOARCH=amd64 go build -o bin/senf-linux-amd64 dist/senf.go

echo "compiling mac version..."
rm bin/senf-darwin-amd64
env GOOS=darwin GOARCH=amd64 go build -o bin/senf-darwin-amd64 dist/senf.go

echo "compiling windows version..."
rm bin/senf-windows-amd64
env GOOS=windows GOARCH=amd64 go build -ldflags -H=windowsgui -o bin/senf-windows-amd64 dist/senf.go

