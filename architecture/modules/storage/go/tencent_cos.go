package storage

import (
	"context"
	"errors"
	cos "github.com/tencentyun/cos-go-sdk-v5"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

func cosError(e error) error {
	if e == nil {
		return nil
	}
	var service *cos.ErrorResponse
	if errors.As(e, &service) && service.Response != nil {
		return statusError(service.Response.StatusCode)
	}
	return Normalize(e)
}
func NewTencentCOS(o CloudOptions) (Provider, error) {
	if e := o.Validate(); e != nil {
		return nil, e
	}
	if o.Credentials == nil {
		return nil, fail("CONFIGURATION")
	}
	client := func(ctx context.Context, public bool) (*cos.Client, Credentials, error) {
		c, e := o.Credentials(ctx)
		if e != nil {
			return nil, c, e
		}
		ep := o.endpoint(public)
		if ep == "" {
			ep = "https://" + o.Bucket + ".cos." + o.Region + ".myqcloud.com"
		}
		u, e := url.Parse(ep)
		if e != nil {
			return nil, c, fail("CONFIGURATION")
		}
		sdk := cos.NewClient(&cos.BaseURL{BucketURL: u}, &http.Client{Timeout: time.Minute, Transport: &cos.AuthorizationTransport{SecretID: c.AccessKeyID, SecretKey: c.SecretAccessKey, SessionToken: c.SessionToken}})
		return sdk, c, nil
	}
	p := &Cloud{name: "tencent-cos"}
	p.sign = func(ctx context.Context, method, key string, size int64, contentType string, ttl time.Duration, public bool) (SignedRequest, error) {
		sdk, c, e := client(ctx, public)
		if e != nil {
			return SignedRequest{}, e
		}
		ttl, e = duration(ttl, c)
		if e != nil {
			return SignedRequest{}, e
		}
		h := http.Header{}
		if method == "PUT" {
			h.Set("Content-Type", contentType)
			h.Set("Content-Length", strconv.FormatInt(size, 10))
		}
		query := url.Values{}
		if method == "GET" {
			query.Set("response-content-disposition", "attachment")
		}
		r, e := sdk.Object.GetPresignedURL2(ctx, method, key, ttl, &cos.PresignedURLOptions{Header: &h, Query: &query}, true)
		if e != nil {
			return SignedRequest{}, cosError(e)
		}
		headers := map[string]string{}
		for k, v := range h {
			if len(v) > 0 && k != "Content-Length" {
				headers[k] = v[0]
			}
		}
		return SignedRequest{Method: method, URL: r.String(), Headers: headers, ExpiresAt: time.Now().Add(ttl).UTC().Format(time.RFC3339Nano)}, nil
	}
	p.head = func(ctx context.Context, key string) (ObjectInfo, error) {
		sdk, _, e := client(ctx, false)
		if e != nil {
			return ObjectInfo{}, e
		}
		r, e := sdk.Object.Head(ctx, key, nil)
		if e != nil {
			return ObjectInfo{}, cosError(e)
		}
		size, e := strconv.ParseInt(r.Header.Get("Content-Length"), 10, 64)
		if e != nil {
			return ObjectInfo{}, fail("UNAVAILABLE")
		}
		return ObjectInfo{Key: key, Size: size, ContentType: r.Header.Get("Content-Type"), ETag: r.Header.Get("ETag")}, nil
	}
	p.remove = func(ctx context.Context, key string) error {
		sdk, _, e := client(ctx, false)
		if e != nil {
			return e
		}
		_, e = sdk.Object.Delete(ctx, key, nil)
		return cosError(e)
	}
	p.list = func(ctx context.Context, in ListInput) (Page, error) {
		sdk, _, e := client(ctx, false)
		if e != nil {
			return Page{}, e
		}
		r, _, e := sdk.Bucket.Get(ctx, &cos.BucketGetOptions{Prefix: in.Prefix, Marker: in.Cursor, MaxKeys: in.Limit})
		if e != nil {
			return Page{}, cosError(e)
		}
		p := Page{Items: []ObjectInfo{}, Cursor: r.NextMarker}
		for _, v := range r.Contents {
			p.Items = append(p.Items, ObjectInfo{Key: v.Key, Size: v.Size, ContentType: "application/octet-stream", ETag: v.ETag})
		}
		return p, nil
	}
	return p, nil
}
