package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"regexp"
	"strings"
	"time"
)

type Error struct {
	Code      string
	Retryable bool
}

func (e *Error) Error() string { return e.Code }
func fail(code string) error   { return &Error{Code: code} }
func Normalize(err error) error {
	if err == nil {
		return nil
	}
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return fail("ABORTED")
	}
	if errors.Is(err, os.ErrNotExist) {
		return fail("NOT_FOUND")
	}
	return &Error{Code: "UNAVAILABLE", Retryable: true}
}
func IsCode(err error, code string) bool {
	var e *Error
	return errors.As(Normalize(err), &e) && e.Code == code
}

type ObjectInfo struct {
	Key         string `json:"key"`
	Size        int64  `json:"size"`
	ContentType string `json:"contentType"`
	ETag        string `json:"etag,omitempty"`
	ModifiedAt  string `json:"modifiedAt,omitempty"`
}
type Page struct {
	Items  []ObjectInfo `json:"items"`
	Cursor string       `json:"cursor,omitempty"`
}
type ListInput struct {
	Prefix string
	Cursor string
	Limit  int
}
type PutInput struct {
	Body        io.Reader
	Size        int64
	ContentType string
}
type Download struct {
	Body io.ReadCloser
	Info ObjectInfo
}
type SignedRequest struct {
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers"`
	ExpiresAt string            `json:"expiresAt"`
}
type Capabilities struct {
	DirectUpload bool     `json:"directUpload"`
	Multipart    bool     `json:"multipart"`
	Resumable    bool     `json:"resumable"`
	Extensions   []string `json:"extensions"`
}
type Provider interface {
	Name() string
	Capabilities() Capabilities
	Put(context.Context, string, PutInput) (ObjectInfo, error)
	Get(context.Context, string) (Download, error)
	Head(context.Context, string) (ObjectInfo, error)
	Delete(context.Context, string) error
	List(context.Context, ListInput) (Page, error)
	SignUpload(context.Context, string, int64, string, time.Duration) (SignedRequest, error)
	SignDownload(context.Context, string, time.Duration) (SignedRequest, error)
}

func ValidKey(key string) error {
	if key == "" || len(key) > 1024 || strings.HasPrefix(key, "/") || strings.ContainsAny(key, "\\%?#") {
		return fail("INVALID_INPUT")
	}
	for _, r := range key {
		if r < 32 || r == 127 {
			return fail("INVALID_INPUT")
		}
	}
	for _, p := range strings.Split(key, "/") {
		if p == "" || p == "." || p == ".." {
			return fail("INVALID_INPUT")
		}
	}
	return nil
}

var contentTypePattern = regexp.MustCompile(`^[-\w.+]+/[-\w.+]+(; ?charset=[-\w]+)?$`)

func validInput(p PutInput) error {
	if p.Body == nil || p.Size < 0 || p.Size > 1<<30 || len(p.ContentType) > 200 || !contentTypePattern.MatchString(p.ContentType) {
		return fail("INVALID_INPUT")
	}
	return nil
}
func limit(n int) (int, error) {
	if n == 0 {
		return 50, nil
	}
	if n < 1 || n > 200 {
		return 0, fail("INVALID_INPUT")
	}
	return n, nil
}
func uuid() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	s := hex.EncodeToString(b[:])
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}

type Router struct {
	Stores       map[string]Provider
	DefaultStore string
}

func NewRouter(stores map[string]Provider, defaultStore string) (*Router, error) {
	r := &Router{Stores: map[string]Provider{}, DefaultStore: defaultStore}
	for k, v := range stores {
		r.Stores[k] = v
	}
	_, e := r.Get(defaultStore)
	return r, e
}
func (r *Router) Get(id string) (Provider, error) {
	if id == "" {
		id = r.DefaultStore
	}
	p, ok := r.Stores[id]
	if !ok || p == nil {
		return nil, fail("CONFIGURATION")
	}
	return p, nil
}
func (r *Router) Close() error {
	for _, p := range r.Stores {
		if c, ok := p.(io.Closer); ok {
			if e := c.Close(); e != nil {
				return e
			}
		}
	}
	return nil
}
