package storage

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Authenticate must verify the project session/token and return its stable user ID.
type HTTPOptions struct {
	Service          *FileService
	Authenticate     func(*http.Request) (string, error)
	BasePath         string
	TrustedOrigins   []string
	AllowCredentials bool
}

func NewFileHandler(options HTTPOptions) (http.Handler, error) {
	base := options.BasePath
	if base == "" {
		base = "/files"
	}
	if !strings.HasPrefix(base, "/") || strings.HasSuffix(base, "/") || strings.ContainsAny(base, "?# ") || options.Service == nil || options.Authenticate == nil {
		return nil, fail("CONFIGURATION")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != base && !strings.HasPrefix(r.URL.Path, base+"/") {
			http.NotFound(w, r)
			return
		}
		requestID := uuid()
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		send := func(v any, status int) {
			if status == 204 {
				w.WriteHeader(status)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(v)
		}
		operation := func() error {
			if origin := r.Header.Get("Origin"); origin != "" {
				allowed := false
				for _, o := range options.TrustedOrigins {
					if origin == o {
						allowed = true
					}
				}
				if !allowed {
					return fail("FORBIDDEN")
				}
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				if options.AllowCredentials {
					w.Header().Set("Access-Control-Allow-Credentials", "true")
				}
			}
			if r.Method == "OPTIONS" {
				w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "authorization,content-type")
				send(nil, 204)
				return nil
			}
			actor, e := options.Authenticate(r)
			if e != nil || actor == "" {
				return fail("FORBIDDEN")
			}
			ctx := r.Context()
			parts := strings.Split(strings.TrimPrefix(r.URL.Path, base+"/"), "/")
			if r.URL.Path == base {
				parts = nil
			}
			s := options.Service
			if r.Method == "POST" && len(parts) == 1 && parts[0] == "uploads" {
				media, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
				if e != nil || media != "application/json" {
					return fail("INVALID_INPUT")
				}
				decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
				decoder.DisallowUnknownFields()
				var input UploadInput
				if e = decoder.Decode(&input); e != nil {
					return fail("INVALID_INPUT")
				}
				var extra any
				if decoder.Decode(&extra) != io.EOF {
					return fail("INVALID_INPUT")
				}
				v, e := s.CreateUpload(ctx, actor, input)
				if e != nil {
					return e
				}
				send(v, 201)
				return nil
			}
			if len(parts) >= 2 && parts[0] == "uploads" {
				id := parts[1]
				if r.Method == "PUT" && len(parts) == 3 && parts[2] == "content" {
					info, e := s.Info(ctx, actor, id)
					if e != nil {
						return e
					}
					if r.Header.Get("Content-Type") != info.ContentType || (r.ContentLength >= 0 && r.ContentLength != info.Size) {
						return fail("INVALID_INPUT")
					}
					if e = s.Upload(ctx, actor, id, http.MaxBytesReader(w, r.Body, info.Size+1)); e != nil {
						return e
					}
					send(nil, 204)
					return nil
				}
				if r.Method == "POST" && len(parts) == 3 {
					var info FileInfo
					var e error
					switch parts[2] {
					case "complete":
						info, e = s.Complete(ctx, actor, id)
					case "recover":
						info, e = s.Recover(ctx, actor, id)
					default:
						return fail("NOT_FOUND")
					}
					if e != nil {
						return e
					}
					send(info, 200)
					return nil
				}
				if r.Method == "DELETE" && len(parts) == 2 {
					if e = s.Cancel(ctx, actor, id); e != nil {
						return e
					}
					send(nil, 204)
					return nil
				}
				return fail("NOT_FOUND")
			}
			if r.Method == "GET" && len(parts) == 0 {
				n := 0
				if r.URL.Query().Has("limit") {
					n, e = strconv.Atoi(r.URL.Query().Get("limit"))
					if e != nil || n < 1 {
						return fail("INVALID_INPUT")
					}
				}
				v, e := s.List(ctx, actor, r.URL.Query().Get("cursor"), n)
				if e != nil {
					return e
				}
				send(v, 200)
				return nil
			}
			if r.Method == "GET" && len(parts) == 1 {
				v, e := s.Info(ctx, actor, parts[0])
				if e != nil {
					return e
				}
				send(v, 200)
				return nil
			}
			if r.Method == "GET" && len(parts) == 2 && parts[1] == "download" {
				v, e := s.DownloadLocation(ctx, actor, parts[0])
				if e != nil {
					return e
				}
				send(v, 200)
				return nil
			}
			if r.Method == "GET" && len(parts) == 2 && parts[1] == "content" {
				info, e := s.Info(ctx, actor, parts[0])
				if e != nil {
					return e
				}
				v, e := s.Download(ctx, actor, parts[0])
				if e != nil {
					return e
				}
				defer v.Body.Close()
				w.Header().Set("Content-Type", v.Info.ContentType)
				w.Header().Set("Content-Length", strconv.FormatInt(v.Info.Size, 10))
				w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+strings.ReplaceAll(url.QueryEscape(info.Name), "+", "%20"))
				if _, e = io.Copy(w, v.Body); e != nil {
					panic(http.ErrAbortHandler)
				}
				return nil
			}
			if r.Method == "DELETE" && len(parts) == 1 {
				if e = s.Delete(ctx, actor, parts[0]); e != nil {
					return e
				}
				send(nil, 204)
				return nil
			}
			return fail("NOT_FOUND")
		}
		if e := operation(); e != nil {
			var typed *Error
			normalized := Normalize(e)
			if !errors.As(normalized, &typed) {
				typed = &Error{Code: "UNAVAILABLE"}
			}
			status := map[string]int{"INVALID_INPUT": 400, "NOT_FOUND": 404, "FORBIDDEN": 403, "CONFLICT": 409, "EXPIRED": 410, "UNSUPPORTED": 501, "UNAVAILABLE": 503, "ABORTED": 499, "CONFIGURATION": 503}[typed.Code]
			if status == 0 {
				status = 503
			}
			send(map[string]string{"code": typed.Code, "requestId": requestID}, status)
		}
	}), nil
}
