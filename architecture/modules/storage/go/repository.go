package storage

import (
	"context"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"
)

type FileInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	ContentType string `json:"contentType"`
	State       string `json:"state"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}
type FileRecord struct {
	FileInfo
	SchemaVersion int    `json:"schemaVersion"`
	OwnerID       string `json:"ownerId"`
	StoreID       string `json:"storeId"`
	ObjectKey     string `json:"objectKey"`
	TempKey       string `json:"tempKey"`
	ExpiresAt     string `json:"expiresAt"`
	Version       int    `json:"version"`
	LeaseUntil    int64  `json:"leaseUntil,omitempty"`
}
type FilePage struct {
	Items  []FileInfo `json:"items"`
	Cursor string     `json:"cursor,omitempty"`
}
type RecordPage struct {
	Items  []FileRecord
	Cursor string
}
type Repository interface {
	Create(context.Context, FileRecord) error
	Get(context.Context, string) (FileRecord, error)
	CompareAndSwap(context.Context, string, int, FileRecord) (bool, error)
	List(context.Context, string, string, int) (RecordPage, error)
}

var idPattern = regexp.MustCompile(`^[a-f0-9-]{36}$`)

func validID(id string) error {
	if !idPattern.MatchString(id) {
		return fail("INVALID_INPUT")
	}
	return nil
}

type FileRepository struct{ root *os.Root }

func NewFileRepository(directory string) (*FileRepository, error) {
	root, e := privateRoot(directory)
	if e != nil {
		return nil, e
	}
	return &FileRepository{root}, nil
}
func (r *FileRepository) Close() error { return r.root.Close() }
func (r *FileRepository) Get(ctx context.Context, id string) (FileRecord, error) {
	var v FileRecord
	if e := ctx.Err(); e != nil {
		return v, Normalize(e)
	}
	if e := validID(id); e != nil {
		return v, e
	}
	e := readJSON(r.root, id+".json", &v)
	if e == nil && (v.ID != id || v.SchemaVersion != 1 || v.Version < 1) {
		e = fail("CONFIGURATION")
	}
	return v, e
}
func (r *FileRepository) Create(ctx context.Context, v FileRecord) error {
	if e := validID(v.ID); e != nil {
		return e
	}
	return fileLock(r.root, v.ID, func() error {
		_, e := r.Get(ctx, v.ID)
		if e == nil {
			return fail("CONFLICT")
		}
		if !IsCode(e, "NOT_FOUND") {
			return e
		}
		return atomicJSON(r.root, v.ID+".json", v)
	})
}
func (r *FileRepository) CompareAndSwap(ctx context.Context, id string, version int, v FileRecord) (bool, error) {
	if e := validID(id); e != nil {
		return false, e
	}
	ok := false
	e := fileLock(r.root, id, func() error {
		old, e := r.Get(ctx, id)
		if e != nil {
			return e
		}
		if old.Version != version {
			return nil
		}
		if v.ID != id || v.Version != version+1 || v.OwnerID != old.OwnerID || v.StoreID != old.StoreID {
			return fail("INVALID_INPUT")
		}
		if e = atomicJSON(r.root, id+".json", v); e != nil {
			return e
		}
		ok = true
		return nil
	})
	return ok, e
}
func (r *FileRepository) List(ctx context.Context, owner, cursor string, pageSize int) (RecordPage, error) {
	n, e := limit(pageSize)
	if e != nil {
		return RecordPage{}, e
	}
	if cursor != "" {
		if e = validID(cursor); e != nil {
			return RecordPage{}, e
		}
	}
	f, e := r.root.Open(".")
	if e != nil {
		return RecordPage{}, Normalize(e)
	}
	defer f.Close()
	items := []FileRecord{}
	for {
		entries, readErr := f.ReadDir(32)
		for _, entry := range entries {
			if !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			id := strings.TrimSuffix(entry.Name(), ".json")
			if !idPattern.MatchString(id) {
				continue
			}
			v, e := r.Get(ctx, id)
			if e != nil {
				return RecordPage{}, e
			}
			if v.OwnerID == owner && v.State == "ready" && v.ID > cursor {
				items = append(items, v)
				sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
				if len(items) > n+1 {
					items = items[:n+1]
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return RecordPage{}, Normalize(readErr)
		}
	}
	result := RecordPage{Items: items}
	if len(items) > n {
		result.Cursor = items[n-1].ID
		result.Items = items[:n]
	}
	return result, nil
}
