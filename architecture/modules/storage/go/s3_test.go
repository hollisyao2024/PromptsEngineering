package storage

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestNewS3Signature(t *testing.T) {
	calls := 0
	options := CloudOptions{Bucket: "test-1250000000", Region: "ap-guangzhou", Credentials: func(context.Context) (Credentials, error) {
		calls++
		return Credentials{AccessKeyID: "fixture-id", SecretAccessKey: "fixture-secret", SessionToken: "fixture-token", Expiration: time.Now().Add(90 * time.Second)}, nil
	}}
	p, e := NewS3(options)
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
	if !strings.Contains(u.Query().Get("X-Amz-SignedHeaders"), "content-length") || signed.Headers["Content-Length"] != "" {
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
	p, e = NewS3(options)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = p.SignDownload(context.Background(), "files/test", time.Minute); e == nil {
		t.Fatal("expired credential accepted")
	}
}

func TestLiveNewS3(t *testing.T) { liveCloud(t, "s3", NewS3) }
