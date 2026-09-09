package storage

import (
	"context"
	"io"
	"strings"
	"time"
)

type UploadInput struct {
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	ContentType string `json:"contentType"`
	StoreID     string `json:"storeId,omitempty"`
}
type UploadTransport struct {
	Kind      string            `json:"kind"`
	Method    string            `json:"method"`
	Path      string            `json:"path,omitempty"`
	URL       string            `json:"url,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	ExpiresAt string            `json:"expiresAt,omitempty"`
}
type UploadSession struct {
	File      FileInfo        `json:"file"`
	ExpiresAt string          `json:"expiresAt"`
	Transport UploadTransport `json:"transport"`
}
type FileService struct {
	Router     *Router
	Repository Repository
	MaxSize    int64
	Lifetime   time.Duration
	Now        func() time.Time
}

func NewFileService(router *Router, repository Repository) *FileService {
	return &FileService{Router: router, Repository: repository, MaxSize: 32 << 20, Lifetime: 15 * time.Minute, Now: time.Now}
}
func (s *FileService) own(ctx context.Context, owner, id string) (FileRecord, error) {
	if owner == "" || len(owner) > 255 {
		return FileRecord{}, fail("FORBIDDEN")
	}
	r, e := s.Repository.Get(ctx, id)
	if e != nil {
		return r, e
	}
	if r.OwnerID != owner {
		return FileRecord{}, fail("NOT_FOUND")
	}
	return r, nil
}
func (s *FileService) move(ctx context.Context, r FileRecord, update func(*FileRecord)) (FileRecord, error) {
	next := r
	update(&next)
	next.Version++
	next.UpdatedAt = s.Now().UTC().Format(time.RFC3339Nano)
	ok, e := s.Repository.CompareAndSwap(ctx, r.ID, r.Version, next)
	if e != nil {
		return r, e
	}
	if !ok {
		return r, fail("CONFLICT")
	}
	return next, nil
}
func (s *FileService) active(r FileRecord) error {
	expiry, e := time.Parse(time.RFC3339Nano, r.ExpiresAt)
	if e != nil || !expiry.After(s.Now()) {
		return fail("EXPIRED")
	}
	return nil
}
func (s *FileService) CreateUpload(ctx context.Context, owner string, input UploadInput) (UploadSession, error) {
	if owner == "" || len(owner) > 255 {
		return UploadSession{}, fail("FORBIDDEN")
	}
	if strings.TrimSpace(input.Name) == "" || len(input.Name) > 255 || strings.ContainsAny(input.Name, "\r\n\x00") || input.Size > s.MaxSize {
		return UploadSession{}, fail("INVALID_INPUT")
	}
	if e := validInput(PutInput{Body: strings.NewReader(""), Size: input.Size, ContentType: input.ContentType}); e != nil {
		return UploadSession{}, e
	}
	if _, e := duration(s.Lifetime, Credentials{}); e != nil {
		return UploadSession{}, e
	}
	store := input.StoreID
	if store == "" {
		store = s.Router.DefaultStore
	}
	p, e := s.Router.Get(store)
	if e != nil {
		return UploadSession{}, e
	}
	id := uuid()
	now := s.Now().UTC()
	r := FileRecord{FileInfo: FileInfo{ID: id, Name: input.Name, Size: input.Size, ContentType: input.ContentType, State: "pending", CreatedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano)}, SchemaVersion: 1, OwnerID: owner, StoreID: store, ObjectKey: "files/" + id + "/" + uuid(), TempKey: "uploads/" + id + "/" + uuid(), ExpiresAt: now.Add(s.Lifetime).Format(time.RFC3339Nano), Version: 1}
	t := UploadTransport{Kind: "proxy", Method: "PUT", Path: "/uploads/" + id + "/content"}
	if p.Capabilities().DirectUpload {
		signed, e := p.SignUpload(ctx, r.TempKey, r.Size, r.ContentType, s.Lifetime)
		if e != nil {
			return UploadSession{}, e
		}
		t = UploadTransport{Kind: "signed", Method: "PUT", URL: signed.URL, Headers: signed.Headers, ExpiresAt: signed.ExpiresAt}
	}
	if e = s.Repository.Create(ctx, r); e != nil {
		return UploadSession{}, e
	}
	return UploadSession{File: r.FileInfo, ExpiresAt: r.ExpiresAt, Transport: t}, nil
}
func (s *FileService) Upload(ctx context.Context, owner, id string, body io.Reader) error {
	r, e := s.own(ctx, owner, id)
	if e != nil {
		return e
	}
	if e = s.active(r); e != nil {
		return e
	}
	if r.State != "pending" {
		return fail("CONFLICT")
	}
	r, e = s.move(ctx, r, func(n *FileRecord) { n.State = "uploading"; n.LeaseUntil = s.Now().Add(5 * time.Minute).UnixMilli() })
	if e != nil {
		return e
	}
	p, e := s.Router.Get(r.StoreID)
	if e != nil {
		return e
	}
	operation, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	_, e = p.Put(operation, r.TempKey, PutInput{Body: body, Size: r.Size, ContentType: r.ContentType})
	if e != nil {
		return e
	}
	_, e = s.move(ctx, r, func(n *FileRecord) { n.State = "pending"; n.LeaseUntil = 0 })
	return e
}
func (s *FileService) Complete(ctx context.Context, owner, id string) (FileInfo, error) {
	r, e := s.own(ctx, owner, id)
	if e != nil {
		return FileInfo{}, e
	}
	if r.State == "ready" {
		return r.FileInfo, nil
	}
	if e = s.active(r); e != nil {
		return FileInfo{}, e
	}
	if r.State != "pending" {
		return FileInfo{}, fail("CONFLICT")
	}
	r, e = s.move(ctx, r, func(n *FileRecord) { n.State = "completing"; n.LeaseUntil = s.Now().Add(5 * time.Minute).UnixMilli() })
	if e != nil {
		return FileInfo{}, e
	}
	p, e := s.Router.Get(r.StoreID)
	if e != nil {
		return FileInfo{}, e
	}
	operation, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	d, e := p.Get(operation, r.TempKey)
	if e != nil {
		return FileInfo{}, e
	}
	defer d.Body.Close()
	if d.Info.Size != r.Size || d.Info.ContentType != r.ContentType {
		return FileInfo{}, fail("INVALID_INPUT")
	}
	_, e = p.Put(operation, r.ObjectKey, PutInput{Body: d.Body, Size: r.Size, ContentType: r.ContentType})
	if e != nil {
		return FileInfo{}, e
	}
	r, e = s.move(ctx, r, func(n *FileRecord) { n.State = "ready"; n.LeaseUntil = 0 })
	if e != nil {
		return FileInfo{}, e
	}
	_ = p.Delete(ctx, r.TempKey)
	return r.FileInfo, nil
}
func (s *FileService) Recover(ctx context.Context, owner, id string) (FileInfo, error) {
	r, e := s.own(ctx, owner, id)
	if e != nil {
		return FileInfo{}, e
	}
	if r.State == "uploading" || r.State == "completing" {
		if r.LeaseUntil > s.Now().UnixMilli() {
			return FileInfo{}, fail("CONFLICT")
		}
		state := r.State
		r, e = s.move(ctx, r, func(n *FileRecord) { n.LeaseUntil = s.Now().Add(5 * time.Minute).UnixMilli() })
		if e != nil {
			return FileInfo{}, e
		}
		if state == "completing" {
			p, e := s.Router.Get(r.StoreID)
			if e != nil {
				return FileInfo{}, e
			}
			if e = p.Delete(ctx, r.ObjectKey); e != nil {
				return FileInfo{}, e
			}
		}
		r, e = s.move(ctx, r, func(n *FileRecord) {
			n.State = "pending"
			n.ObjectKey = "files/" + n.ID + "/" + uuid()
			n.LeaseUntil = 0
		})
		if e != nil {
			return FileInfo{}, e
		}
	} else if r.State == "deleting" {
		if e = s.Delete(ctx, owner, id); e != nil {
			return FileInfo{}, e
		}
		return s.Info(ctx, owner, id)
	}
	return r.FileInfo, nil
}
func (s *FileService) Cancel(ctx context.Context, owner, id string) error {
	r, e := s.own(ctx, owner, id)
	if e != nil {
		return e
	}
	if r.State == "pending" {
		r, e = s.move(ctx, r, func(n *FileRecord) { n.State = "cancelled" })
		if e != nil {
			return e
		}
	} else if r.State != "cancelled" {
		return fail("CONFLICT")
	}
	p, e := s.Router.Get(r.StoreID)
	if e != nil {
		return e
	}
	return p.Delete(ctx, r.TempKey)
}
func (s *FileService) Info(ctx context.Context, owner, id string) (FileInfo, error) {
	r, e := s.own(ctx, owner, id)
	return r.FileInfo, e
}
func (s *FileService) Download(ctx context.Context, owner, id string) (Download, error) {
	r, e := s.own(ctx, owner, id)
	if e != nil {
		return Download{}, e
	}
	if r.State != "ready" {
		return Download{}, fail("NOT_FOUND")
	}
	p, e := s.Router.Get(r.StoreID)
	if e != nil {
		return Download{}, e
	}
	return p.Get(ctx, r.ObjectKey)
}
func (s *FileService) DownloadLocation(ctx context.Context, owner, id string) (map[string]any, error) {
	r, e := s.own(ctx, owner, id)
	if e != nil {
		return nil, e
	}
	if r.State != "ready" {
		return nil, fail("NOT_FOUND")
	}
	p, e := s.Router.Get(r.StoreID)
	if e != nil {
		return nil, e
	}
	if p.Capabilities().DirectUpload {
		signed, e := p.SignDownload(ctx, r.ObjectKey, 5*time.Minute)
		if e != nil {
			return nil, e
		}
		return map[string]any{"url": signed.URL, "headers": signed.Headers, "expiresAt": signed.ExpiresAt}, nil
	}
	return map[string]any{"path": "/" + id + "/content"}, nil
}
func (s *FileService) Delete(ctx context.Context, owner, id string) error {
	r, e := s.own(ctx, owner, id)
	if e != nil {
		return e
	}
	if r.State == "deleted" {
		return nil
	}
	if r.State == "ready" {
		r, e = s.move(ctx, r, func(n *FileRecord) { n.State = "deleting" })
		if e != nil {
			return e
		}
	} else if r.State != "deleting" {
		return fail("CONFLICT")
	}
	p, e := s.Router.Get(r.StoreID)
	if e != nil {
		return e
	}
	if e = p.Delete(ctx, r.ObjectKey); e != nil {
		return e
	}
	if e = p.Delete(ctx, r.TempKey); e != nil {
		return e
	}
	_, e = s.move(ctx, r, func(n *FileRecord) { n.State = "deleted" })
	return e
}
func (s *FileService) List(ctx context.Context, owner, cursor string, n int) (FilePage, error) {
	if owner == "" {
		return FilePage{}, fail("FORBIDDEN")
	}
	page, e := s.Repository.List(ctx, owner, cursor, n)
	if e != nil {
		return FilePage{}, e
	}
	result := FilePage{Items: []FileInfo{}, Cursor: page.Cursor}
	for _, r := range page.Items {
		result.Items = append(result.Items, r.FileInfo)
	}
	return result, nil
}
