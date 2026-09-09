package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"sort"
	"strings"
	"time"
)

type Local struct{ root *os.Root }
type localEntry struct {
	ObjectInfo
	Blob string `json:"blob"`
}

func NewLocal(directory string) (*Local, error) {
	root, e := privateRoot(directory)
	if e != nil {
		return nil, e
	}
	return &Local{root}, nil
}
func (p *Local) Close() error               { return p.root.Close() }
func (p *Local) Name() string               { return "local" }
func (p *Local) Capabilities() Capabilities { return Capabilities{Extensions: []string{}} }
func localName(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:]) + ".json"
}
func (p *Local) entry(key string) (localEntry, error) {
	var v localEntry
	if e := ValidKey(key); e != nil {
		return v, e
	}
	e := readJSON(p.root, localName(key), &v)
	if e == nil && (v.Key != key || !strings.HasPrefix(v.Blob, "blob-") || strings.ContainsAny(v.Blob, "/\\")) {
		e = fail("CONFIGURATION")
	}
	return v, e
}
func (p *Local) Put(ctx context.Context, key string, input PutInput) (result ObjectInfo, err error) {
	if e := ValidKey(key); e != nil {
		return result, e
	}
	if e := validInput(input); e != nil {
		return result, e
	}
	err = fileLock(p.root, localName(key), func() error {
		old, e := p.entry(key)
		if e != nil && !IsCode(e, "NOT_FOUND") {
			return e
		}
		blob := "blob-" + uuid()
		f, e := p.root.OpenFile(blob, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return Normalize(e)
		}
		hash := sha256.New()
		n, e := io.Copy(io.MultiWriter(f, hash), io.LimitReader(&contextReader{ctx: ctx, r: input.Body}, input.Size+1))
		if e == nil && n != input.Size {
			e = fail("INVALID_INPUT")
		}
		if e == nil {
			e = f.Sync()
		}
		closeErr := f.Close()
		if e == nil {
			e = closeErr
		}
		if e != nil {
			_ = p.root.Remove(blob)
			return Normalize(e)
		}
		result = ObjectInfo{Key: key, Size: n, ContentType: input.ContentType, ETag: hex.EncodeToString(hash.Sum(nil)), ModifiedAt: time.Now().UTC().Format(time.RFC3339Nano)}
		if e = atomicJSON(p.root, localName(key), localEntry{result, blob}); e != nil {
			_ = p.root.Remove(blob)
			return e
		}
		if old.Blob != "" {
			_ = p.root.Remove(old.Blob)
		}
		return nil
	})
	return
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r *contextReader) Read(p []byte) (int, error) {
	if e := r.ctx.Err(); e != nil {
		return 0, e
	}
	return r.r.Read(p)
}
func (p *Local) Head(ctx context.Context, key string) (ObjectInfo, error) {
	if e := ctx.Err(); e != nil {
		return ObjectInfo{}, Normalize(e)
	}
	v, e := p.entry(key)
	return v.ObjectInfo, e
}
func (p *Local) Get(ctx context.Context, key string) (Download, error) {
	if e := ctx.Err(); e != nil {
		return Download{}, Normalize(e)
	}
	v, e := p.entry(key)
	if e != nil {
		return Download{}, e
	}
	s, e := p.root.Lstat(v.Blob)
	if e != nil {
		return Download{}, Normalize(e)
	}
	if !s.Mode().IsRegular() {
		return Download{}, fail("CONFIGURATION")
	}
	f, e := p.root.Open(v.Blob)
	if e != nil {
		return Download{}, Normalize(e)
	}
	return Download{Body: f, Info: v.ObjectInfo}, nil
}
func (p *Local) Delete(ctx context.Context, key string) error {
	if e := ctx.Err(); e != nil {
		return Normalize(e)
	}
	if e := ValidKey(key); e != nil {
		return e
	}
	return fileLock(p.root, localName(key), func() error {
		v, e := p.entry(key)
		if IsCode(e, "NOT_FOUND") {
			return nil
		}
		if e != nil {
			return e
		}
		if e = p.root.Remove(localName(key)); e != nil {
			return Normalize(e)
		}
		e = p.root.Remove(v.Blob)
		if os.IsNotExist(e) {
			return nil
		}
		return Normalize(e)
	})
}
func (p *Local) List(ctx context.Context, input ListInput) (Page, error) {
	n, e := limit(input.Limit)
	if e != nil {
		return Page{}, e
	}
	if input.Cursor != "" {
		if e = ValidKey(input.Cursor); e != nil {
			return Page{}, e
		}
	}
	if len(input.Prefix) > 1024 {
		return Page{}, fail("INVALID_INPUT")
	}
	dir, e := p.root.Open(".")
	if e != nil {
		return Page{}, Normalize(e)
	}
	defer dir.Close()
	items := []ObjectInfo{}
	for {
		entries, e := dir.ReadDir(32)
		for _, entry := range entries {
			if ctx.Err() != nil {
				return Page{}, Normalize(ctx.Err())
			}
			if len(entry.Name()) != 69 || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			var v localEntry
			if e = readJSON(p.root, entry.Name(), &v); e != nil {
				return Page{}, e
			}
			if v.Key > input.Cursor && strings.HasPrefix(v.Key, input.Prefix) {
				items = append(items, v.ObjectInfo)
				sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })
				if len(items) > n+1 {
					items = items[:n+1]
				}
			}
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			return Page{}, Normalize(e)
		}
	}
	result := Page{Items: items}
	if len(items) > n {
		result.Cursor = items[n-1].Key
		result.Items = items[:n]
	}
	return result, nil
}
func (p *Local) SignUpload(context.Context, string, int64, string, time.Duration) (SignedRequest, error) {
	return SignedRequest{}, fail("UNSUPPORTED")
}
func (p *Local) SignDownload(context.Context, string, time.Duration) (SignedRequest, error) {
	return SignedRequest{}, fail("UNSUPPORTED")
}
