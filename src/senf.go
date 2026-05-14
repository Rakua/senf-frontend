package main

import (
	"embed"
	"fmt"
	"net/http"
	"os"
)

const sfVersion = "$SF_VERSION"
const sfBuildDate = "$SF_BUILD_DATE"
const defaultPort = "8055"
const devMode = false // set to true to enable loading files from file system (hot reload)

const help = `Senf frontend version ` + sfVersion + `, usage:
senf       - starts webserver listening on localhost:8045
senf $PORT - starts webserver listening on localhost:$PORT
senf $PORT $CERT_PEM_FILE $KEY_PEM_FILE - starts webserver with TLS listening on localhost:$PORT`

//go:embed index.html main.js config.js favicon.ico version.js config.dev.js dev.js tsconfig.tsbuildinfo assets/* modules/*
var staticAssets embed.FS

func main() {
	if len(os.Args) > 1 {
		if os.Args[1] == "help" {
			fmt.Println(help)
			os.Exit(0)
		}
	}

	var fileServer http.Handler
	var err error

	if devMode {
		//serve files from file system (hot reload)
		fileServer = http.FileServer(http.Dir(""))
	} else {
		//serve files embedded in binary
		fileServer = http.FileServer(http.FS(staticAssets))
	}

	handler := func(w http.ResponseWriter, r *http.Request) {
		// cache content for an hour
		w.Header().Set("Cache-Control", "public, max-age 3600")
		fileServer.ServeHTTP(w, r)
	}

	http.HandleFunc("/", handler)

	protocol := "http"
	port := defaultPort
	if len(os.Args) > 1 {
		// first cmd-line argument can be used to specify custom listening port
		port = os.Args[1]
	}
	if len(os.Args) > 3 {
		protocol = "https"
	}
	addr := fmt.Sprintf("localhost:%v", port)
	fmt.Printf("Senf frontend v%v (%v) is listening on %s://%s\n", sfVersion, sfBuildDate, protocol, addr)
	if devMode {
		fmt.Println("Dev mode enabled")
	}

	// start the HTTP server
	if len(os.Args) > 3 {
		certPem := os.Args[2]
		keyPem := os.Args[3]
		err = http.ListenAndServeTLS(addr, certPem, keyPem, nil)
	} else {
		err = http.ListenAndServe(addr, nil)
	}

	if err != nil {
		fmt.Println("Error:", err)
	}
}
