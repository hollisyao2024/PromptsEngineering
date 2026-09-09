package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T) (*FileService, *Local) {
	t.Helper()
	root, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	p, e := NewLocal(filepath.Join(root, "objects"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { p.Close() })
	repo, e := NewFileRepository(filepath.Join(root, "metadata"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { repo.Close() })
	router, e := NewRouter(map[string]Provider{"first": p}, "first")
	if e != nil {
		t.Fatal(e)
	}
	return NewFileService(router, repo), p
}
func TestLocalAndSession(t *testing.T) {
	s, p := fixture(t)
	ctx := context.Background()
	data := []byte{0, 1, 127, 255}
	u, e := s.CreateUpload(ctx, "alice", UploadInput{Name: "image.bin", Size: 4, ContentType: "application/octet-stream"})
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Upload(ctx, "alice", u.File.ID, bytes.NewReader(data)); e != nil {
		t.Fatal(e)
	}
	info, e := s.Complete(ctx, "alice", u.File.ID)
	if e != nil || info.State != "ready" {
		t.Fatal(info, e)
	}
	if _, e = s.Download(ctx, "bob", u.File.ID); !IsCode(e, "NOT_FOUND") {
		t.Fatal(e)
	}
	d, e := s.Download(ctx, "alice", u.File.ID)
	if e != nil {
		t.Fatal(e)
	}
	body, e := io.ReadAll(d.Body)
	d.Body.Close()
	if e != nil || !bytes.Equal(body, data) {
		t.Fatal(body, e)
	}
	record, e := s.Repository.Get(ctx, u.File.ID)
	if e != nil {
		t.Fatal(e)
	}
	_, e = p.Put(ctx, record.TempKey, PutInput{Body: strings.NewReader("evil"), Size: 4, ContentType: "application/octet-stream"})
	if e != nil {
		t.Fatal(e)
	}
	d, e = s.Download(ctx, "alice", u.File.ID)
	if e != nil {
		t.Fatal(e)
	}
	body, _ = io.ReadAll(d.Body)
	d.Body.Close()
	if !bytes.Equal(body, data) {
		t.Fatal("signed upload replay modified the completed object")
	}
	s.Router.DefaultStore = "missing"
	if _, e = s.Download(ctx, "alice", u.File.ID); e != nil {
		t.Fatal("record lost its store", e)
	}
	if e = s.Delete(ctx, "alice", u.File.ID); e != nil {
		t.Fatal(e)
	}
	if e = s.Delete(ctx, "alice", u.File.ID); e != nil {
		t.Fatal(e)
	}
	for _, key := range []string{"../escape", "a/%2e%2e", "/root", "a\\b"} {
		if _, e = p.Put(ctx, key, PutInput{Body: strings.NewReader(""), Size: 0, ContentType: "text/plain"}); !IsCode(e, "INVALID_INPUT") {
			t.Fatal(key, e)
		}
	}
	if _, e = p.Put(ctx, "short", PutInput{Body: strings.NewReader("short"), Size: 8, ContentType: "text/plain"}); !IsCode(e, "INVALID_INPUT") {
		t.Fatal(e)
	}
	if _, e = p.Put(ctx, "empty", PutInput{Body: strings.NewReader(""), Size: 0, ContentType: "text/plain"}); e != nil {
		t.Fatal(e)
	}
	root, _ := filepath.EvalSymlinks(t.TempDir())
	if e = os.Symlink(root, filepath.Join(root, "alias")); e != nil {
		t.Fatal(e)
	}
	if _, e = NewLocal(filepath.Join(root, "alias", "objects")); e == nil {
		t.Fatal("accepted symlink directory")
	}
}
func TestHTTPAndRecovery(t *testing.T) {
	s, _ := fixture(t)
	h, e := NewFileHandler(HTTPOptions{Service: s, Authenticate: func(r *http.Request) (string, error) { return r.Header.Get("Authorization"), nil }, TrustedOrigins: []string{"http://localhost:5173"}})
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(h)
	defer server.Close()
	request := func(method, path, body, contentType, owner string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("Authorization", owner)
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { res.Body.Close() })
		return res
	}
	res := request("POST", "/files/uploads", `{"name":"hello.txt","size":5,"contentType":"text/plain"}`, "application/json", "alice")
	if res.StatusCode != 201 {
		b, _ := io.ReadAll(res.Body)
		t.Fatal(res.StatusCode, string(b))
	}
	var u UploadSession
	if e = json.NewDecoder(res.Body).Decode(&u); e != nil {
		t.Fatal(e)
	}
	if res = request("PUT", "/files"+u.Transport.Path, "hello", "text/plain", "alice"); res.StatusCode != 204 {
		t.Fatal(res.StatusCode)
	}
	if res = request("POST", "/files/uploads/"+u.File.ID+"/complete", "", "", "alice"); res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	if res = request("GET", "/files/"+u.File.ID+"/content", "", "", "bob"); res.StatusCode != 404 {
		t.Fatal(res.StatusCode)
	}
	if res = request("GET", "/files/"+u.File.ID+"/content", "", "", "alice"); res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Disposition"), "attachment") {
		t.Fatal(res.StatusCode)
	}
	if res = request("GET", "/files", "", "", ""); res.StatusCode != 403 {
		t.Fatal(res.StatusCode)
	}
	ctx := context.Background()
	v, e := s.CreateUpload(ctx, "alice", UploadInput{Name: "retry", Size: 2, ContentType: "text/plain"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Complete(ctx, "alice", v.File.ID); !IsCode(e, "NOT_FOUND") {
		t.Fatal(e)
	}
	if _, e = s.Recover(ctx, "alice", v.File.ID); !IsCode(e, "CONFLICT") {
		t.Fatal(e)
	}
	now := time.Now().Add(6 * time.Minute)
	s.Now = func() time.Time { return now }
	if _, e = s.Recover(ctx, "alice", v.File.ID); e != nil {
		t.Fatal(e)
	}
	if e = s.Upload(ctx, "alice", v.File.ID, strings.NewReader("ok")); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Complete(ctx, "alice", v.File.ID); e != nil {
		t.Fatal(e)
	}
}
