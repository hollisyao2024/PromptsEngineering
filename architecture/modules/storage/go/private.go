package storage

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
)

func privateRoot(directory string) (*os.Root, error) {
	if !filepath.IsAbs(directory) || filepath.Clean(directory) == filepath.VolumeName(directory)+string(os.PathSeparator) {
		return nil, fail("CONFIGURATION")
	}
	for p := filepath.Clean(directory); p != filepath.Dir(p); p = filepath.Dir(p) {
		s, e := os.Lstat(p)
		if e == nil && (s.Mode()&os.ModeSymlink != 0 || !s.IsDir()) {
			return nil, fail("CONFIGURATION")
		}
		if e != nil && !os.IsNotExist(e) {
			return nil, Normalize(e)
		}
	}
	if e := os.MkdirAll(directory, 0700); e != nil {
		return nil, Normalize(e)
	}
	s, e := os.Stat(directory)
	if e != nil {
		return nil, Normalize(e)
	}
	if s.Mode().Perm()&0077 != 0 {
		return nil, fail("CONFIGURATION")
	}
	r, e := os.OpenRoot(directory)
	return r, Normalize(e)
}
func readJSON(root *os.Root, name string, value any) error {
	s, e := root.Lstat(name)
	if e != nil {
		return Normalize(e)
	}
	if !s.Mode().IsRegular() || s.Size() > 65536 {
		return fail("CONFIGURATION")
	}
	f, e := root.Open(name)
	if e != nil {
		return Normalize(e)
	}
	defer f.Close()
	return Normalize(json.NewDecoder(io.LimitReader(f, 65537)).Decode(value))
}
func atomicJSON(root *os.Root, name string, value any) error {
	b, e := json.Marshal(value)
	if e != nil || len(b) > 65536 {
		return fail("INVALID_INPUT")
	}
	tmp := ".tmp-" + uuid()
	f, e := root.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return Normalize(e)
	}
	_, e = f.Write(b)
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e == nil {
		e = closeErr
	}
	if e == nil {
		e = root.Rename(tmp, name)
	}
	if e != nil {
		_ = root.Remove(tmp)
	}
	return Normalize(e)
}
func fileLock(root *os.Root, name string, action func() error) error {
	f, e := root.OpenFile(name+".lock", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if os.IsExist(e) {
		return fail("CONFLICT")
	}
	if e != nil {
		return Normalize(e)
	}
	defer func() { _ = f.Close(); _ = root.Remove(name + ".lock") }()
	if e = json.NewEncoder(f).Encode(map[string]int{"pid": os.Getpid()}); e != nil {
		return Normalize(e)
	}
	if e = f.Sync(); e != nil {
		return Normalize(e)
	}
	return action()
}
