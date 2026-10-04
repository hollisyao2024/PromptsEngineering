package storage

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNewAliyunOSSSignature(t *testing.T) {
	calls := 0
	options := CloudOptions{Bucket: "test-1250000000", Region: "ap-guangzhou", Credentials: func(context.Context) (Credentials, error) {
		calls++
		return Credentials{AccessKeyID: "fixture-id", SecretAccessKey: "fixture-secret", SessionToken: "fixture-token", Expiration: time.Now().Add(90 * time.Second)}, nil
	}}
	p, e := NewAliyunOSS(options)
	if e != nil {
		t.Fatal(e)
	}
	signed, e := p.SignUpload(context.Background(), "uploads/test", 4, "text/plain", time.Hour)
	if e != nil {
		t.Fatal(e)
	}
	u, e := url.Parse(signed.URL)
	if e != nil || u.Scheme != "https" || len(u.RawQuery) < 20 || signed.Headers["Content-Type"] != "text/plain" {
		t.Fatal("invalid signature result", e)
	}
	if !strings.Contains(u.Query().Get("x-oss-additional-headers"), "content-length") || signed.Headers["Content-Length"] != "" {
		t.Fatal("declared size not bound or forbidden browser header returned")
	}
	expiry, e := time.Parse(time.RFC3339, signed.ExpiresAt)
	if e != nil || time.Until(expiry) > 90*time.Second {
		t.Fatal("credential expiration not respected", e)
	}
	if _, e = p.SignDownload(context.Background(), "files/test", time.Minute); e != nil || calls < 2 {
		t.Fatal("credential refresh", e)
	}
	if _, e = p.SignUpload(context.Background(), "../escape", 4, "text/plain", time.Minute); !IsCode(e, "INVALID_INPUT") {
		t.Fatal(e)
	}
	options.Credentials = func(context.Context) (Credentials, error) {
		return Credentials{AccessKeyID: "fixture", SecretAccessKey: "fixture", Expiration: time.Now().Add(-time.Minute)}, nil
	}
	p, e = NewAliyunOSS(options)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = p.SignDownload(context.Background(), "files/test", time.Minute); e == nil {
		t.Fatal("expired credential accepted")
	}
}

func TestLiveNewAliyunOSS(t *testing.T) { liveCloud(t, "aliyun-oss", NewAliyunOSS) }

func TestOSSVersionPort(t *testing.T) {
	p, e := NewAliyunOSS(CloudOptions{Bucket: "fixture-bucket", Region: "cn-shanghai", Credentials: func(context.Context) (Credentials, error) {
		return Credentials{AccessKeyID: "fixture", SecretAccessKey: "fixture"}, nil
	}})
	if e != nil {
		t.Fatal(e)
	}
	if _, ok := p.(interface {
		HeadVersion(context.Context, string, string) (ObjectInfo, error)
	}); !ok {
		t.Fatal("OSS version port missing")
	}
}

func TestOSSVersionsProtocol(t *testing.T) {
	for _, initial := range []string{"", "Enabled", "Suspended"} {
		t.Run("mode-"+initial, func(t *testing.T) {
			var mu sync.Mutex
			mode := initial
			deny := false
			deleted := ""
			reads := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				defer mu.Unlock()
				q := r.URL.Query()
				if q.Has("versioning") {
					w.Header().Set("Content-Type", "application/xml")
					if deny {
						w.WriteHeader(403)
						io.WriteString(w, "<Error><Code>AccessDenied</Code></Error>")
						return
					}
					io.WriteString(w, "<VersioningConfiguration><Status>"+mode+"</Status></VersioningConfiguration>")
					return
				}
				if q.Has("versions") {
					w.Header().Set("Content-Type", "application/xml")
					if q.Get("key-marker") == "" {
						io.WriteString(w, "<ListVersionsResult><Name>fixture-bucket</Name><IsTruncated>true</IsTruncated><NextKeyMarker>files/a</NextKeyMarker><NextVersionIdMarker>v1</NextVersionIdMarker><Version><Key>files/a</Key><VersionId>v1</VersionId><Size>3</Size></Version></ListVersionsResult>")
					} else {
						io.WriteString(w, "<ListVersionsResult><Name>fixture-bucket</Name><IsTruncated>false</IsTruncated><DeleteMarker><Key>files/a</Key><VersionId>d1</VersionId></DeleteMarker></ListVersionsResult>")
					}
					return
				}
				if q.Has("list-type") {
					w.Header().Set("Content-Type", "application/xml")
					if q.Get("continuation-token") == "" {
						io.WriteString(w, "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>page2</NextContinuationToken><Contents><Key>files/a</Key><Size>3</Size></Contents></ListBucketResult>")
					} else {
						io.WriteString(w, "<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>files/b</Key><Size>3</Size></Contents></ListBucketResult>")
					}
					return
				}
				if r.Method == "DELETE" {
					deleted = q.Get("versionId")
					w.WriteHeader(204)
					return
				}
				if q.Get("versionId") == "missing" {
					reads++
					w.WriteHeader(404)
					io.WriteString(w, "<Error><Code>NoSuchVersion</Code></Error>")
					return
				}
				if r.Method == "PUT" {
					io.Copy(io.Discard, r.Body)
					return
				}
				w.Header().Set("Content-Length", "3")
				w.Header().Set("Content-Type", "application/octet-stream")
				if v := q.Get("versionId"); v != "" && v != "null" {
					w.Header().Set("X-Oss-Version-Id", v)
				}
				if r.Method != "HEAD" {
					io.WriteString(w, "old")
				}
			}))
			defer server.Close()
			ctx := context.Background()
			base, e := NewAliyunOSS(CloudOptions{Bucket: "fixture-bucket", Region: "cn-shanghai", Endpoint: server.URL, AllowHTTP: true, ForcePathStyle: true, Credentials: func(context.Context) (Credentials, error) {
				return Credentials{AccessKeyID: "fixture", SecretAccessKey: "fixture"}, nil
			}})
			if e != nil {
				t.Fatal(e)
			}
			p, ok := base.(VersionedProvider)
			if !ok {
				t.Fatal("missing versioned provider")
			}
			h, e := p.Head(ctx, "files/a")
			if e != nil || h.VersionID != "null" {
				t.Fatal(h, e)
			}
			h, e = p.Put(ctx, "files/new", PutInput{Body: strings.NewReader("new"), Size: 3, ContentType: "text/plain"})
			if e != nil || h.VersionID != "null" {
				t.Fatal(h, e)
			}
			d, e := p.GetVersion(ctx, "files/a", "null")
			if e != nil {
				t.Fatal(e)
			}
			b, e := io.ReadAll(d.Body)
			d.Body.Close()
			if e != nil || string(b) != "old" || d.Info.VersionID != "null" {
				t.Fatal(d.Info, e)
			}
			h, e = p.HeadVersion(ctx, "files/a", "v1")
			if e != nil || h.VersionID != "v1" {
				t.Fatal(h, e)
			}
			if e = p.DeleteVersion(ctx, "files/a", "null"); e != nil {
				t.Fatal(e)
			}
			mu.Lock()
			v := deleted
			mu.Unlock()
			if v != "null" {
				t.Fatal(v)
			}
			if _, e = p.GetVersion(ctx, "files/a", "missing"); !IsCode(e, "NOT_FOUND") {
				t.Fatal(e)
			}
			mu.Lock()
			count := reads
			mu.Unlock()
			if count != 1 {
				t.Fatal("fallback read", count)
			}
			first, e := p.ListVersions(ctx, ListInput{Prefix: "files/", Limit: 1})
			if e != nil || len(first.Items) != 1 || first.Cursor == "" {
				t.Fatal(first, e)
			}
			second, e := p.ListVersions(ctx, ListInput{Prefix: "files/", Limit: 1, Cursor: first.Cursor})
			if e != nil || len(second.Items) != 1 || second.Cursor != "" || second.Items[0].DeleteMarker != (initial != "") {
				t.Fatal(second, e)
			}
			if _, e = p.ListVersions(ctx, ListInput{Prefix: "other/", Cursor: first.Cursor}); !IsCode(e, "INVALID_INPUT") {
				t.Fatal(e)
			}
			mu.Lock()
			if mode == "" {
				mode = "Enabled"
			} else {
				mode = ""
			}
			mu.Unlock()
			if _, e = p.ListVersions(ctx, ListInput{Prefix: "files/", Cursor: first.Cursor}); !IsCode(e, "CONFLICT") {
				t.Fatal(e)
			}
			mu.Lock()
			mode = "Unknown"
			mu.Unlock()
			if _, e = p.ListVersions(ctx, ListInput{Prefix: "files/"}); !IsCode(e, "UNAVAILABLE") {
				t.Fatal(e)
			}
			mu.Lock()
			deny = true
			mu.Unlock()
			if _, e = p.ListVersions(ctx, ListInput{Prefix: "files/"}); !IsCode(e, "FORBIDDEN") {
				t.Fatal(e)
			}
		})
	}
}
