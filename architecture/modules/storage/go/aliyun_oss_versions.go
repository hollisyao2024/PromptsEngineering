package storage

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"strings"
	"time"
)

type ossVersionProvider struct {
	*Cloud
	bucket string
	client func(context.Context, bool) (*oss.Client, Credentials, error)
}
type ossCursor struct {
	Mode    string `json:"mode"`
	Prefix  string `json:"prefix"`
	Key     string `json:"key"`
	Version string `json:"version"`
	Token   string `json:"token"`
}

func ossVersionID(v *string) (string, error) {
	if v == nil {
		return "null", nil
	}
	return *v, validVersionID(*v)
}
func (p *ossVersionProvider) HeadVersion(ctx context.Context, key, version string) (ObjectInfo, error) {
	if e := ValidKey(key); e != nil {
		return ObjectInfo{}, e
	}
	if e := validVersionID(version); e != nil {
		return ObjectInfo{}, e
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	sdk, _, e := p.client(ctx, false)
	if e != nil {
		return ObjectInfo{}, Normalize(e)
	}
	r, e := sdk.HeadObject(ctx, &oss.HeadObjectRequest{Bucket: oss.Ptr(p.bucket), Key: oss.Ptr(key), VersionId: oss.Ptr(version)})
	if e != nil {
		return ObjectInfo{}, ossError(e)
	}
	v, e := ossVersionID(r.VersionId)
	if e != nil || r.ContentLength < 0 {
		return ObjectInfo{}, fail("UNAVAILABLE")
	}
	if v != version {
		return ObjectInfo{}, fail("CONFLICT")
	}
	return ObjectInfo{Key: key, Size: r.ContentLength, ContentType: oss.ToString(r.ContentType), VersionID: v}, nil
}
func (p *ossVersionProvider) GetVersion(ctx context.Context, key, version string) (Download, error) {
	if e := ValidKey(key); e != nil {
		return Download{}, e
	}
	if e := validVersionID(version); e != nil {
		return Download{}, e
	}
	sdk, _, e := p.client(ctx, false)
	if e != nil {
		return Download{}, Normalize(e)
	}
	r, e := sdk.GetObject(ctx, &oss.GetObjectRequest{Bucket: oss.Ptr(p.bucket), Key: oss.Ptr(key), VersionId: oss.Ptr(version)})
	if e != nil {
		return Download{}, ossError(e)
	}
	v, e := ossVersionID(r.VersionId)
	if e != nil || r.ContentLength < 0 {
		r.Body.Close()
		return Download{}, fail("UNAVAILABLE")
	}
	if v != version {
		r.Body.Close()
		return Download{}, fail("CONFLICT")
	}
	return Download{Body: r.Body, Info: ObjectInfo{Key: key, Size: r.ContentLength, ContentType: oss.ToString(r.ContentType), VersionID: v}}, nil
}
func (p *ossVersionProvider) DeleteVersion(ctx context.Context, key, version string) error {
	if e := ValidKey(key); e != nil {
		return e
	}
	if e := validVersionID(version); e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	sdk, _, e := p.client(ctx, false)
	if e != nil {
		return Normalize(e)
	}
	_, e = sdk.DeleteObject(ctx, &oss.DeleteObjectRequest{Bucket: oss.Ptr(p.bucket), Key: oss.Ptr(key), VersionId: oss.Ptr(version)})
	return ossError(e)
}
func (p *ossVersionProvider) ListVersions(ctx context.Context, in ListInput) (VersionPage, error) {
	n, e := limit(in.Limit)
	if e != nil {
		return VersionPage{}, e
	}
	if len(in.Prefix) > 1024 || len(in.Cursor) > 8192 || strings.ContainsAny(in.Prefix, "\x00\r\n") {
		return VersionPage{}, fail("INVALID_INPUT")
	}
	var cursor ossCursor
	if in.Cursor != "" {
		b, e := base64.RawURLEncoding.DecodeString(in.Cursor)
		if e != nil || json.Unmarshal(b, &cursor) != nil || cursor.Prefix != in.Prefix {
			return VersionPage{}, fail("INVALID_INPUT")
		}
	}
	if in.Cursor != "" {
		b, _ := json.Marshal(cursor)
		if base64.RawURLEncoding.EncodeToString(b) != in.Cursor || (cursor.Mode != "" && cursor.Mode != "Enabled" && cursor.Mode != "Suspended") || (cursor.Mode == "" && cursor.Token == "") || (cursor.Mode != "" && (ValidKey(cursor.Key) != nil || !strings.HasPrefix(cursor.Key, in.Prefix) || validVersionID(cursor.Version) != nil)) {
			return VersionPage{}, fail("INVALID_INPUT")
		}
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	sdk, _, e := p.client(ctx, false)
	if e != nil {
		return VersionPage{}, Normalize(e)
	}
	state, e := sdk.GetBucketVersioning(ctx, &oss.GetBucketVersioningRequest{Bucket: oss.Ptr(p.bucket)})
	if e != nil {
		return VersionPage{}, ossError(e)
	}
	mode := oss.ToString(state.VersionStatus)
	if mode != "" && mode != "Enabled" && mode != "Suspended" {
		return VersionPage{}, fail("UNAVAILABLE")
	}
	if in.Cursor != "" && cursor.Mode != mode {
		return VersionPage{}, fail("CONFLICT")
	}
	page := VersionPage{Items: []ObjectVersion{}}
	next := ossCursor{Mode: mode, Prefix: in.Prefix}
	truncated := false
	if mode == "" {
		r, e := sdk.ListObjectsV2(ctx, &oss.ListObjectsV2Request{Bucket: oss.Ptr(p.bucket), Prefix: oss.Ptr(in.Prefix), ContinuationToken: oss.Ptr(cursor.Token), MaxKeys: int32(n)})
		if e != nil {
			return page, ossError(e)
		}
		for _, v := range r.Contents {
			page.Items = append(page.Items, ObjectVersion{ObjectInfo: ObjectInfo{Key: oss.ToString(v.Key), Size: v.Size, ContentType: "application/octet-stream", VersionID: "null"}})
		}
		truncated = r.IsTruncated
		next.Token = oss.ToString(r.NextContinuationToken)
	} else {
		r, e := sdk.ListObjectVersions(ctx, &oss.ListObjectVersionsRequest{Bucket: oss.Ptr(p.bucket), Prefix: oss.Ptr(in.Prefix), KeyMarker: oss.Ptr(cursor.Key), VersionIdMarker: oss.Ptr(cursor.Version), MaxKeys: int32(n)})
		if e != nil {
			return page, ossError(e)
		}
		for _, v := range r.ObjectVersions {
			page.Items = append(page.Items, ObjectVersion{ObjectInfo: ObjectInfo{Key: oss.ToString(v.Key), Size: v.Size, ContentType: "application/octet-stream", VersionID: oss.ToString(v.VersionId)}})
		}
		for _, v := range r.ObjectDeleteMarkers {
			page.Items = append(page.Items, ObjectVersion{ObjectInfo: ObjectInfo{Key: oss.ToString(v.Key), ContentType: "application/octet-stream", VersionID: oss.ToString(v.VersionId)}, DeleteMarker: true})
		}
		truncated = r.IsTruncated
		next.Key = oss.ToString(r.NextKeyMarker)
		next.Version = oss.ToString(r.NextVersionIdMarker)
	}
	seen := map[string]bool{}
	if len(page.Items) > n {
		return page, fail("UNAVAILABLE")
	}
	for _, v := range page.Items {
		identity := v.Key + "\x00" + v.VersionID
		if ValidKey(v.Key) != nil || validVersionID(v.VersionID) != nil || !strings.HasPrefix(v.Key, in.Prefix) || v.Size < 0 || seen[identity] {
			return VersionPage{}, fail("UNAVAILABLE")
		}
		seen[identity] = true
	}
	if truncated {
		b, _ := json.Marshal(next)
		page.Cursor = base64.RawURLEncoding.EncodeToString(b)
		if len(page.Cursor) > 8192 || len(page.Items) == 0 || page.Cursor == in.Cursor || (mode == "" && next.Token == "") || (mode != "" && (ValidKey(next.Key) != nil || validVersionID(next.Version) != nil || !strings.HasPrefix(next.Key, in.Prefix))) {
			return VersionPage{}, fail("UNAVAILABLE")
		}
	}
	return page, nil
}
