package main

import (
 "context"
 "encoding/json"
 "log"
 "net/http"
 "os"
 "os/signal"
 "syscall"
 "time"
)
func handler() http.Handler {
 mux := http.NewServeMux()
 mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.Header().Set("Content-Type", "application/json"); _ = json.NewEncoder(w).Encode(map[string]string{"status":"ok"}) })
 return mux
}
func main() {
 port:=os.Getenv("PORT"); if port=="" { port="3001" }
 host:=os.Getenv("HOST"); if host=="" { host="127.0.0.1" }
 server:=&http.Server{Addr:host+":"+port,Handler:handler(),ReadHeaderTimeout:5*time.Second}
 ctx,stop:=signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM);defer stop()
 go func(){<-ctx.Done(); timeout,cancel:=context.WithTimeout(context.Background(),10*time.Second);defer cancel();_ = server.Shutdown(timeout)}()
 if err:=server.ListenAndServe();err!=nil&&err!=http.ErrServerClosed {log.Fatal(err)}
}
