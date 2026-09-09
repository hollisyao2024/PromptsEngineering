package main

import (
	"net/http"
	"os"
	"path/filepath"
	storage "xirang.local/storage"
)

// Project owned integration. Mount the returned handler at /files and /files/.
func NewProjectFiles(dataRoot string, authenticate func(*http.Request) (string, error), origins []string) (http.Handler, func(), error) {
	router, err := storage.NewConfiguredStorage(dataRoot, os.Getenv)
	if err != nil {
		return nil, nil, err
	}
	repository, err := storage.NewFileRepository(filepath.Join(dataRoot, "file-metadata"))
	if err != nil {
		router.Close()
		return nil, nil, err
	}
	closeFiles := func() { repository.Close(); router.Close() }
	handler, err := storage.NewFileHandler(storage.HTTPOptions{Service: storage.NewFileService(router, repository), Authenticate: authenticate, TrustedOrigins: origins})
	if err != nil {
		closeFiles()
		return nil, nil, err
	}
	return handler, closeFiles, nil
}
