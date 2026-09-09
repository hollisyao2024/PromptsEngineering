package storage

import (
	"bytes"
	"context"
	"io"
	"os"
	"testing"
	"time"
)

func liveCloud(t *testing.T, name string, create func(CloudOptions) (Provider, error)) {
	t.Helper()
	if os.Getenv("XIRANG_LIVE_STORAGE_PROVIDER") != name {
		t.Skip("Real cloud unverified: opt in with XIRANG_LIVE_STORAGE_PROVIDER and LIVE_*")
	}
	p, e := create(CloudOptions{Bucket: os.Getenv("LIVE_BUCKET"), Region: os.Getenv("LIVE_REGION"), Endpoint: os.Getenv("LIVE_ENDPOINT"), PublicEndpoint: os.Getenv("LIVE_PUBLIC_ENDPOINT"), Credentials: func(context.Context) (Credentials, error) {
		return Credentials{AccessKeyID: os.Getenv("LIVE_ACCESS_KEY_ID"), SecretAccessKey: os.Getenv("LIVE_SECRET_ACCESS_KEY"), SessionToken: os.Getenv("LIVE_SESSION_TOKEN")}, nil
	}})
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	key := "xirang-integration/" + uuid()
	body := []byte{0, 127, 255}
	defer func() {
		if e := p.Delete(context.Background(), key); e != nil {
			t.Error(e)
		}
	}()
	if _, e = p.Put(ctx, key, PutInput{Body: bytes.NewReader(body), Size: int64(len(body)), ContentType: "application/octet-stream"}); e != nil {
		t.Fatal(e)
	}
	d, e := p.Get(ctx, key)
	if e != nil {
		t.Fatal(e)
	}
	got, e := io.ReadAll(d.Body)
	d.Body.Close()
	if e != nil || !bytes.Equal(got, body) {
		t.Fatal("roundtrip failed", e)
	}
	page, e := p.List(ctx, ListInput{Prefix: key, Limit: 1})
	if e != nil || len(page.Items) != 1 || page.Items[0].Key != key {
		t.Fatal("list failed", e)
	}
}
