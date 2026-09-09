package storage

import (
	"context"
	"encoding/json"
	"regexp"
)

type ExtensionProvider interface {
	Extension(context.Context, string, json.RawMessage) (json.RawMessage, error)
}

func RunStorageExtension(ctx context.Context, provider Provider, name string, input json.RawMessage) (json.RawMessage, error) {
	if !regexp.MustCompile("^[a-z][a-z0-9.-]{1,63}$").MatchString(name) || len(input) > 65536 || !json.Valid(input) {
		return nil, fail("INVALID_INPUT")
	}
	supported := false
	for _, operation := range provider.Capabilities().Extensions {
		if operation == name {
			supported = true
		}
	}
	adapter, ok := provider.(ExtensionProvider)
	if !supported || !ok {
		return nil, fail("UNSUPPORTED")
	}
	output, e := adapter.Extension(ctx, name, input)
	return output, Normalize(e)
}
